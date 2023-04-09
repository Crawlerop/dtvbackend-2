const express = require("express");
const path = require("path");
const fs_sync = require("fs");
const fs = require("fs/promises");
const luxon = require("luxon");
const proc = require("process");
const dvb2ip = require("../dvb2ip");
const crypto = require("crypto");
const check_output = require('../utils/check_output')
const cp = require("child_process")
const axios = require("axios")
const os = require("os")
const nc = require("nominatim-client")
const jobs = require("./dtvJobs")
const rtmp = require("./rtmp")
const dvrLib = require("./dvr")

const config = require("../config.json")

const nominatim = nc.createClient({
    "useragent": "DTV Backend",
    "referer": "https://dvb.ucomsite.my.id/"
})

const streams = require("../db/streams");
const dvr = require("../db/dvr")

const app = express();

app.enable("trust proxy")
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']) 
app.use(express.json())


var geo_params = {}

//const StreamDTV = new bull("broadcast dtv");

const cors = require("cors")

app.get("/", (req,res)=>{res.sendFile(path.resolve(path.join(__dirname,"/../website/index.html")))})
app.get("/index.html", (req,res)=>{res.sendFile(path.resolve(path.join(__dirname,"/../website/index.html")))})
app.use("/static/", express.static(path.resolve(path.join(__dirname, "/../website_res/"))))

app.use("/dvr/", express.static(path.resolve(config.dvr_path.replace(/\(pathname\)/g, __dirname+"/../")), {index: false, setHeaders: (res, path) => {
    if (path.endsWith(".m3u8")) {
        res.header('Content-Type', 'application/x-mpegurl')
    }
}}))

app.get("/play/:stream/:file/:file2?", cors(), async (req, res) => {
    const file_path = req.params.file+(req.params.file2 ? ("/"+req.params.file2) : "")

    if (file_path.endsWith(".ts")) {
        const have_stream = await streams.query().where("stream_id", "=", req.params.stream)
        if (have_stream.length <= 0) {
            return res.status(404).json({error: "This stream is non-existent."})
        }

        const streams_path = `${path.resolve(config.streams_path.replace(/\(pathname\)/g, __dirname+"/../"))}/${req.params.stream}/`
        if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).json({error: "This stream is not available."})
        if (!fs_sync.existsSync(`${streams_path}/${file_path}`)) return res.status(404).json({error: "Not found"})
        
        return res.status(200).sendFile(path.resolve(`${streams_path}/${file_path}`))                          
    } else if (file_path.endsWith(".m3u8")) {
        const have_stream = await streams.query().where("stream_id", "=", req.params.stream)
        if (have_stream.length <= 0) {
            return res.status(404).json({error: "This stream is non-existent."})
        }

        const streams_path = `${path.resolve(config.streams_path.replace(/\(pathname\)/g, __dirname+"/../"))}/${req.params.stream}/`
        if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).json({error: "This stream is not available."})

        try {
            const hls_ts_file = await fs.readFile(`${streams_path}/${file_path}`, {encoding: "utf-8"})

            return res.status(200).header("Content-Type", "application/x-mpegurl").end(hls_ts_file.replace(/\r/g, "").replace(/#EXT-X-MEDIA-SEQUENCE/g, `#EXT-X-PLAY-ON:DTVAnywhere\n#EXT-X-STREAM-NAME:${have_stream[0].name}\n#EXT-X-STREAM-SOURCE:${have_stream[0].type}\n#EXT-X-STREAM-HOSTNAME:${os.hostname()}\n#EXT-X-MEDIA-SEQUENCE`))
        } catch (e) {            
            if (e.code == "ENOENT") {
                res.status(404).json({error: "Not found"})
            } else {
                console.trace(e)
                res.status(500).json({error: e})
            }         
        }

    } else {
        return res.status(403).json({error: "Not OTT content"})
    }
})

app.use(function(req, res, next) {
    var schema = req.headers["x-forwarded-proto"];

    req.schema = schema ? schema : "http"

    next();
});

//const stream = require("stream")

/* API */
app.get("/api/status", async (req,res) => {
    var tuners_stat = []

    try {
        const tuners = (await check_output("tslsdvb", [], 0, null, new stream.Writable({write:()=>{}}))).toString("ascii").replace(/\r/g, "").split("\n")
        for (let i = 0; i<(tuners.length-1); i++) {
            const tuner_stat = (await check_output('tslsdvb', ['-a', i, '-e'], 0, null, new stream.Writable({write:()=>{}}), true)).toString("ascii").replace(/\r/g, "").split("\n")
            var status;
            var current;

            for (let j = 0; j<tuner_stat.length; j++) {
                if (tuner_stat[j].indexOf("Current ") !== -1) {
                    current = tuner_stat[j].slice(tuner_stat[j].indexOf("Current "))
                } else if (tuner_stat[j].indexOf("Signal: ") !== -1) {
                    status = tuner_stat[j].slice(tuner_stat[j].indexOf("Signal: "))
                }
            }

            tuners_stat.push({name: tuners[i], status, current: current ? current : "Current N/A"})
        }
    } catch {}

    return res.status(200).json(tuners_stat)
})

app.get("/playlist.m3u", cors(), async (req, res) => {
    const streams_ = await streams.query()
    var streams_out = []
    var m3u = "#EXTM3U\n"

    for (let i = 0; i<streams_.length; i++) {
        const stream = streams_[i]
        if (stream.type === "dtv") {
            const sp = JSON.parse(stream.params)
            var ch_mux = []
            for (let j = 0; j<sp.channels.length; j++) {
                const st_channel = sp.channels[j]
                m3u += `#EXTINF:-1 tvg-id="${stream.stream_id}-${st_channel.id}",${st_channel.name}\n${req.schema}://${req.headers["x-forwarded-prefix"] ? req.headers["x-forwarded-prefix"] : (req.headers.host+'/play')}/${stream.stream_id}/${st_channel.id}/index.m3u8\n`
            }
        } else {
            m3u += `#EXTINF:-1 tvg-id="${stream.stream_id}",${stream.name}\n${req.schema}://${req.headers["x-forwarded-prefix"] ? req.headers["x-forwarded-prefix"] : (req.headers.host+'/play')}/${stream.stream_id}/index.m3u8\n`
        }
    }
    return res.status(200).header("Content-Type", "application/x-mpegurl").end(m3u)
})

app.get("/api/config", (req,res) => {
    res.status(200).json(config)
})

app.post("/api/config", async (req,res) => {
    await fs.writeFile(path.resolve(path.join(__dirname, "/../config.json")), JSON.stringify(req.body, null, 4))
    res.status(200).json({status: "OK"})
    setTimeout(() => {
        process.on("exit", function () {
            cp.spawn(process.argv.shift(), process.argv, {
                cwd: process.cwd(),
                detached : true,
                stdio: "inherit"
            });
        });
        process.exit(0);
    }, 3000)
})

app.get("/api/streams", cors(), async (req, res) => {
    const streams_ = await streams.query()
    var streams_out = []
    for (let i = 0; i<streams_.length; i++) {
        const stream = streams_[i]
        if (stream.type === "dtv") {
            const sp = JSON.parse(stream.params)
            var ch_mux = []
            for (let j = 0; j<sp.channels.length; j++) {
                const st_channel = sp.channels[j]
                ch_mux.push(
                    {
                        name: st_channel.name,
                        id: st_channel.id,
                        is_hd: st_channel.is_hd,
                        playback_url: `${req.headers["x-forwarded-prefix"] ? req.protocol + "://" + req.headers["x-forwarded-prefix"] : "/play"}/${stream.stream_id}/${st_channel.id}/index.m3u8`,
                        stream_path: `${stream.stream_id}/${st_channel.id}`
                    }
                )
            }
            streams_out.push({
                name: stream.name,
                id: stream.stream_id,
                type: stream.type,
                active: Boolean(stream.active),
                channels: ch_mux
            })
        } else {
            streams_out.push({
                name: stream.name,
                id: stream.stream_id,
                type: stream.type,
                active: Boolean(stream.active),
                channels: [
                    {
                        name: stream.name,
                        id: 0,
                        is_hd: false,
                        playback_url: `${req.headers["x-forwarded-prefix"] ? req.protocol + "://" + req.headers["x-forwarded-prefix"] : "/play"}/${stream.stream_id}/index.m3u8`,
                        stream_path: `${stream.stream_id}`
                    }
                ]
            })
        }
    }
    return res.status(200).json(streams_out)
});

//const m3u8 = require("m3u8")
var DVR_STREAMS = {}
var DVR_PROC = {}

app.post("/api/dvr/status", async (req, res) => {
    if (!req.body.id) return res.status(400).json({error: "A stream id must be specified."})

    const stream = await streams.query().where("stream_id", "=", req.body.id)
    if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})

    if (stream[0].type == "dtv") {
        if (!req.body.program) return res.status(400).json({error: "A program must be specified."})
        return res.status(200).json({is_recording: dvrLib.DVR_STREAMS[`${req.body.id}/${req.body.program}`] !== undefined, recordings: await dvr.query().where("stream_id", "=", req.body.id).where("channel", "=", req.body.program).orderBy("created_on", "desc")})
    } else {
        return res.status(200).json({is_recording: dvrLib.DVR_STREAMS[req.body.id] !== undefined, recordings: await dvr.query().where("stream_id", "=", req.body.id).orderBy("created_on", "desc")})
    }
})

app.post("/api/dvr/delete", async (req, res) => {
    if (!req.body.id) return res.status(400).json({error: "A DVR id must be specified."})

    const dvri = await dvr.query().where("dvr_id", "=", req.body.id)
    if (dvri.length <= 0) return res.status(400).json({error: `A DVR with id ${req.body.id} could not be found.`})

    await dvr.query().delete().where("dvr_id", "=", req.body.id)
    try {
        await fs.rm(`${path.resolve(config.dvr_path.replace(/\(pathname\)/g, __dirname+"/../"))}/${req.body.id}`, {force: true, recursive: true})
    } catch (e) {}

    return res.status(200).json({status: "OK"})
})

app.post("/api/dvr/start", async (req, res) => {
    if (!req.body.id) return res.status(400).json({error: "A stream id must be specified."})

    const stream = await streams.query().where("stream_id", "=", req.body.id)
    if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})

    if (!stream[0].active) res.status(400).json({error: "Stream is not active"})

    const DVRStatus = await dvrLib.start(req.body.id, stream[0], req.body.program)

    return res.status(DVRStatus.error ? 400 : 200).json({error: DVRStatus.error ? DVRStatus.error : undefined, status: !DVRStatus.error ? "OK" : undefined})
})

app.post("/api/dvr/stop", async (req, res) => {
    if (!req.body.id) return res.status(400).json({error: "A stream id must be specified."})

    const stream = await streams.query().where("stream_id", "=", req.body.id)
    if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})

    if (!stream[0].active) res.status(200).json({error: "Stream is not active"})

    const DVRStatus = await dvrLib.stop(req.body.id, stream[0], req.body.program)

    return res.status(DVRStatus.error ? 400 : 200).json({error: DVRStatus.error ? DVRStatus.error : undefined, status: !DVRStatus.error ? "OK" : undefined})
})

app.post("/api/shutdown", (req, res) => {
    res.status(200).json({status: "OK"})
    setTimeout(async () => {
        await jobs.forceStop()

        process.exit(0)
    }, 2000)
})

app.post("/api/rtmp_publish_url", async (req, res) => {
    if (!req.body.id) return res.status(400).json({"error": "A channel id must be specified"})

    const stream = await streams.query().where("stream_id", "=", req.body.id)
    if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})
    if (stream[0].type !== "rtmp") return res.status(400).json({error: `channel ${req.body.id} is not an RTMP stream`})

    return res.status(200).json({publish_url: `rtmp://${req.hostname}:${config.rtmp_settings.port}/live/${JSON.parse(stream[0].params).rtmp_key}`})
});

app.post("/api/dvb2ip_get", async (req, res) => {
    if (!req.body.src) return res.status(400).json({"error": "A source address must be specified."})
    try {
        const dvb2ip_arr = await dvb2ip(req.body.src)
        var dvb2ip_ar = []

        for (let i = 0; i<dvb2ip_arr.length; i++) {
            dvb2ip_ar.push({name: dvb2ip_arr[i].name.replace(/(HD$)/g, ""), stream_id: dvb2ip_arr[i].stream_id})
        }

        return res.status(200).json({channels: dvb2ip_ar})
    } catch (e) {
        return res.status(200).json({channels: []})
    }
});

app.post("/api/active", async (req, res) => {    
    if (!req.body.id && !req.body.active) return res.status(400).json({error: "A channel id and active flag must be specified."})
    const stream = await streams.query().where("stream_id", '=', req.body.id)
    if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})
    await streams.query().patch({active: req.body.active}).where("stream_id", '=', req.body.id)
    if (req.body.active) {
        jobs.addDTVJobs(req.body.id, stream[0].type, JSON.parse(stream[0].params), stream[0].name)
    } else {
        jobs.removeDTVJobs(req.body.id, stream[0])
    }
    return res.status(200).json({status: "ok"})
});

app.post("/api/delete", async (req, res) => {    
    if (!req.body.id) return res.status(400).json({error: "A channel id must be specified."})
    const stream = await streams.query().where("stream_id", '=', req.body.id)
    if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})    
    jobs.removeDTVJobs(req.body.id, stream[0])

    await streams.query().delete().where("stream_id", '=', req.body.id)
    await dvr.query().delete().where("stream_id", '=', req.body.id)

    return res.status(200).json({status: "ok"})
});

app.post("/api/add", async (req, res) => {
    if (!req.body.type) return res.status(400).json({error: "You must specify the stream type"})    
    var random_id = crypto.randomBytes(32).toString("hex")

    switch (req.body.type) {
        case "rtmp":
            if (!req.body.name) return res.status(400).json({error: "A stream name must be specified"}) 
            await streams.query().insert({
                stream_id: random_id,
                name: req.body.name,
                type: req.body.type,
                active: true,
                params: {
                    rtmp_key: crypto.randomBytes(32).toString("hex"),
                    passthrough: req.body.passthrough !== undefined ? req.body.passthrough : false
                }
            })
            return res.status(200).json({status: "ok", id: random_id})            
        case "dvb2ip":
            if (!req.body.name || !req.body.source_id || !req.body.source_address) return res.status(400).json({error: "A stream name, channel source id, and source address must be specified"}) 
            await streams.query().insert({
                stream_id: random_id,
                name: req.body.name,
                type: req.body.type,
                params: {
                    src: req.body.source_address,
                    src_id: req.body.source_id,
                    additional_params: req.body.additional_params
                }
            })
            return res.status(200).json({status: "ok", id: random_id})                        
        case "dtv":
            if (!req.body.name || req.body.tuner === undefined || !req.body.frequency || !req.body.channels) return res.status(400).json({error: "A stream name, tuner id, frequency, and channels must be specified"}) 
            await streams.query().insert({
                stream_id: random_id,
                name: req.body.name,
                type: req.body.type,
                params: {
                    tuner: req.body.tuner,
                    frequency: req.body.frequency,
                    channels: req.body.channels,
                    system: req.body.system ? req.body.system : "DVB-T2",
                    additional_params: req.body.additional_params
                }
            })
            return res.status(200).json({status: "ok", id: random_id}) 
        case "pull":
            if (!req.body.source) return res.status(400).json({error: "A source address must be specified"}) 
            await streams.query().insert({
                stream_id: random_id,
                name: req.body.name,
                type: req.body.type,
                params: {
                    source: req.body.source,
                    realtime: req.body.realtime ? req.body.realtime : false,
                    passthrough: req.body.passthrough ? req.body.passthrough : false
                }
            })
            return res.status(200).json({status: "ok", id: random_id})                                      
        default:
            return res.status(400).json({error: "Invalid channel input type"})
    }
});

/*
streams.query().insert({
    stream_id: "updatetest",
    name: "a",
    type: "rtmp",
    active: true,
    params: {
        rtmp_key: "12345"
    }
}).then(() => {
    streams.query().where("stream_id", "=", "updatetest").then((d) => {
        console.log(d[0])
        streams.query().patch({
            stream_id: "updatetest2",
            name: "a2",
            type: "rtmp",
            active: true,
            params: {
                rtmp_key: "12345"
            }
        }).where("stream_id", "=", "updatetest").then(() => {
            streams.query().where("stream_id", "=", "updatetest2").then((d) => {
                console.log(d[0])                
            })
        })
    })
})
*/

app.post("/api/edit", async (req, res) => {
    if (!req.body.type || !req.body.id) return res.status(400).json({error: "A channel id and stream type must be specified"})    
    const stream = await streams.query().where("stream_id", '=', req.body.id)
    if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})
    
    switch (req.body.type) {
        case "rtmp":
            if (!req.body.name) return res.status(400).json({error: "A stream name must be specified"}) 
            let rtmp_params = JSON.parse(stream[0].params)
            rtmp_params.passthrough = req.body.passthrough !== undefined ? req.body.passthrough : false
            if (!rtmp_params.rtmp_key) rtmp_params.rtmp_key = crypto.randomBytes(32).toString("hex")

            await streams.query().patch({                
                name: req.body.name,
                type: req.body.type,
                params: JSON.stringify(rtmp_params)
            }).where("stream_id", '=', req.body.id)
            return res.status(200).json({status: "ok"})            
        case "dvb2ip":
            if (!req.body.name || !req.body.source_id || !req.body.source_address) return res.status(400).json({error: "A stream name, channel source id, and source address must be specified"}) 
            await streams.query().patch({
                name: req.body.name,
                type: req.body.type,
                params: JSON.stringify({
                    src: req.body.source_address,
                    src_id: req.body.source_id,
                    additional_params: req.body.additional_params
                })
            }).where("stream_id", '=', req.body.id)

            jobs.removeDTVJobs(req.body.id, stream[0])

            if (stream[0].active) jobs.addDTVJobs(req.body.id, req.body.type, {
                src: req.body.source_address,
                src_id: req.body.source_id,
                additional_params: req.body.additional_params
            }, req.body.name)
            return res.status(200).json({status: "ok"})                        
        case "dtv":
            if (!req.body.name || req.body.tuner === undefined || !req.body.frequency || !req.body.channels) return res.status(400).json({error: "A stream name, tuner id, frequency, and channels must be specified"}) 
            await streams.query().patch({                
                name: req.body.name,
                type: req.body.type,
                params: JSON.stringify({
                    tuner: req.body.tuner,
                    frequency: req.body.frequency,
                    channels: req.body.channels,
                    system: req.body.system ? req.body.system : "DVB-T2",
                    additional_params: req.body.additional_params
                })
            }).where("stream_id", '=', req.body.id)

            jobs.removeDTVJobs(req.body.id, stream[0])

            if (stream[0].active) jobs.addDTVJobs(req.body.id, req.body.type, {
                tuner: req.body.tuner,
                frequency: req.body.frequency,
                channels: req.body.channels,
                system: req.body.system ? req.body.system : "DVB-T2",
                additional_params: req.body.additional_params
            })
            return res.status(200).json({status: "ok"})          
        case "pull":
            if (!req.body.source) return res.status(400).json({error: "A source address must be specified"}) 
            await streams.query().patch({
                name: req.body.name,
                type: req.body.type,
                params: JSON.stringify({
                    source: req.body.source,
                    realtime: req.body.realtime ? req.body.realtime : false,
                    passthrough: req.body.passthrough ? req.body.passthrough : false
                })
            }).where("stream_id", '=', req.body.id)

            jobs.removeDTVJobs(req.body.id, stream[0])
            
            if (stream[0].active) jobs.addDTVJobs(req.body.id, req.body.type, {
                source: req.body.source,
                realtime: req.body.realtime ? req.body.realtime : false,
                passthrough: req.body.passthrough ? req.body.passthrough : false
            })
            return res.status(200).json({status: "ok"})                          
        default:
            return res.status(400).json({error: "Invalid channel input type"})
    }
});

app.post("/api/get_channels_by_frequency", async (req, res) => {
    if (req.body.tuner === undefined || req.body.frequency === undefined || req.body.bandwidth === undefined || req.body.system_type === undefined) return res.status(400).json({"error": "A tuner, frequency, system type, and bandwidth parameters were required."})
    //if (req.body.system_type === "ISDB-T" && req.body.isdb_type === undefined) req.res.status(400).json({error: "The system type must be specified for ISDB-T streams"})
    try {
        var dtv_chunk = null
        var found = false

        for (let b = 0; b<5; b++) {
            try {
                dtv_chunk = await check_output('tsp', `-I dvb --signal-timeout 2 --guard-interval auto --receive-timeout 10 --adapter ${req.body.tuner} --delivery-system ${req.body.system_type} --frequency ${req.body.frequency*1e6} ${req.body.system_type !== "ATSC" ? `--bandwidth ${req.body.bandwidth*1e6} ` : ''}--transmission-mode auto --spectral-inversion off`.split(" "), 128)
                found = true
                break;
            } catch (e) {}
        }

        if (!found) throw new Error("no channels were found at this frequency")
        const probe_streams = JSON.parse((await check_output(config.ffmpeg.replace(/mpeg/g, "probe"), "-loglevel quiet -print_format json -show_error -probesize 1024M -analyzeduration 60000000 -show_format -show_programs -".split(" "), 0, dtv_chunk)).toString("utf-8")).programs

        var channels_temp = []
        for (let i = 0; i<probe_streams.length; i++) {
            var program = probe_streams[i];
            var program_streams = [];
            var is_hd = false;

            for (let j = 0; j<program.streams.length; j++) {
                var stream = program.streams[j];
                if (stream.codec_type == "video") {
                    if (stream.height >= 720) is_hd = true
                    program_streams.push({
                        type: "video", 
                        width: stream.width > 0 ? stream.width : 720, 
                        height: stream.height > 0 ? stream.height : 576,
                        fps: eval(stream.avg_frame_rate),
                        interlace: stream.field_order,
                        id: eval(stream.id),
                        codec: stream.codec_name
                    })
                } else if (stream.codec_type == "audio" && eval(stream.sample_rate) > 0) {
                    program_streams.push({
                        type: "audio", 
                        sample_rate: eval(stream.sample_rate),
                        channels: stream.channels,
                        bitrate: eval(stream.bit_rate) / 1000,
                        id: eval(stream.id),
                        codec: stream.codec_name
                    })
                }
            }

            channels_temp.push({name:program.tags ? program.tags.service_name.replace(/(HD$)/g, "") : `CH${program.program_id}_${program.pmt_pid}_${program.pcr_pid}`, provider:program.tags ? program.tags.service_provider : "",channel_id:program.program_id,channel_pid:[program.pmt_pid,program.pcr_pid],is_hd, streams:program_streams})
        }
        return res.status(200).json({channels: channels_temp})
    } catch (e) {
        return res.status(200).json({channels: []})
    }
});

const stream = require("stream")

app.get("/api/tuners", async (req, res) => {
    var tuner = [];
    try {
        const tuners = (await check_output("tslsdvb", [], 0, null, new stream.Writable({write:()=>{}}))).toString("ascii").replace(/\r/g, "").split("\n")
        
        for (let i = 0; i<tuners.length; i++) {
            if (tuners[i]) tuner.push(tuners[i])
        }
    } catch (e) {}

    return res.status(200).json({
        status: "ok",
        tuners: tuner
    })
})

app.get("/manifest.json", cors(), async (req, res) => {
    return res.status(200).json({
        name: config.name,
        hostname: os.hostname(),
        server_uptime: os.uptime(),
        os_name: `${os.type()} ${os.release()}`,
        num_streams: (await streams.query()).length,
        country: geo_params.country,
        region_id: geo_params.region_id,
        dtv_area: geo_params.dtv_area,
        is_geoblock: config.dtv_geoblock
    })
})

app.post("/api/get_channel_info", async (req, res) => {
    if (!req.body.id) return res.status(400).json({error: "A channel id must be specified."})
    const stream = await streams.query().select(["name", "type", "params"]).where("stream_id", '=', req.body.id)
    if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})

    stream[0].params = JSON.parse(stream[0].params)

    return res.status(200).json(stream[0])
})

const getDistance = (lat1, lon1, lat2, lon2, unit) => {
    if ((lat1 == lat2) && (lon1 == lon2)) {
        return 0;
    }
    else {
        var radlat1 = Math.PI * lat1/180;
        var radlat2 = Math.PI * lat2/180;
        var theta = lon1-lon2;
        var radtheta = Math.PI * theta/180;
        var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
        if (dist > 1) {
            dist = 1;
        }
        dist = Math.acos(dist);
        dist = dist * 180/Math.PI;
        dist = dist * 60 * 1.1515;
        if (unit=="K") { dist = dist * 1.609344 }
        if (unit=="N") { dist = dist * 0.8684 }
        return dist;
    }
}

const dtvRegions = require("../dtv_areas.json")
const dtv_postcode = require("../dtv_postcodes.json")

const getRegion = (lat, lng) => {
    var min_dist = null
    var min_region = null

    for (let i = 0; i<dtvRegions.length; i++) {
        const dtvRegion = dtvRegions[i]
        const dist = getDistance(lat, lng, dtvRegion.lat, dtvRegion.lng, "K")
        if (min_dist === null || dist<min_dist) {
            min_dist = dist
            min_region = dtvRegion.area
        }
    }

    return min_region
}

const PORT = proc.env["PORT"] ? proc.env["PORT"] : config.port

const startIngress = () => {
    setTimeout(async () => {
        const active_streams = await streams.query().where("active", '=', true)
        for (let v = 0; v<active_streams.length; v++) {        
            jobs.addDTVJobs(active_streams[v].stream_id, active_streams[v].type, JSON.parse(active_streams[v].params), active_streams[v].name)
        }
    }, 5000)
}

const tsDuckAvailable = async () => {
    try {
        await check_output("tsp", ["--version"])
        return true
    } catch (e) {
        return false
    }
}

const ffmpegAvailable = async () => {
    try {
        await check_output(config.ffmpeg, ["-version"])
        return true
    } catch (e) {
        try {
            await check_output(path.resolve(path.join(__dirname, "/../bin/ffmpeg")), ["-version"])
        } catch (e) {
            return false
        }
    }
}

module.exports = {
    run: () => {
        return new Promise(async (res, rej) => {
            if (!await tsDuckAvailable()) {
                console.error("TSDuck is not installed. You can install TSDuck at https://tsduck.io")
                proc.exit(1)
            }

            if (!await ffmpegAvailable()) {
                console.error("FFmpeg is not available. Please download FFmpeg files at https://ffmpeg.org and put into the \"bin\" folder.")
                proc.exit(1)
            }

            app.listen(PORT, "127.0.0.1", async () => {        
                const geoip_res = await axios.get("https://dtvtools.ucomsite.my.id/geoip/json")
                const geoip_data = geoip_res.data

                geo_params = {
                    country: geoip_data.country,
                    region_id: null,
                    dtv_area: null
                }

                /*
                manifest_data = {
                    name: config.name,
                    hostname: os.hostname(),
                    server_uptime: os.uptime(),
                    os_name: `${os.type()} ${os.release()}`,
                    num_streams: (await streams.query()).length,
                    country: geoip_data.country,
                    region_id: null
                }
                */

                try {
                    const n_res = await nominatim.reverse({lat: geoip_data.ll[0], lon: geoip_data.ll[1], zoom: 17})

                    if (!n_res.error && n_res.address.postcode) {
                        const zip_code = n_res.address.postcode
                        //console.log(n_res)
                        switch (geoip_data.country) {
                            case "ID":
                                for (d in dtv_postcode) {
                                    if (zip_code.slice(0,3) == d) {                                
                                        geo_params.region_id = dtv_postcode[d]
                                        geo_params.dtv_area = getRegion(geoip_data.ll[0], geoip_data.ll[1])
                                        break
                                    }
                                }
                                break
                            default:
                                geo_params.region_id = `${n_res.address["ISO3166-2-lvl4"]}/${n_res.address.city.toUpperCase()}`
                                geo_params.dtv_area = n_res.address.city
                                break
                        }
                    }
                } catch (e) {
                    console.trace(e)
                }
                
                console.log(`Live on port ${PORT}`)
                rtmp.start()

                startIngress()
                return res(geo_params)
            })
        })
    }
}
