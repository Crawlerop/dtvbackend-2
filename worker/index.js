const fastify = require("fastify")
const fastify_cors = require("@fastify/cors")
const fastify_static = require("@fastify/static")
const config = require("../config.json")
const path = require("path")
const cp = require("child_process")
const crypto = require("crypto")
const fs = require("fs/promises")
const fs_sync = require("fs")
const os = require("os")

const streams = require("../db/streams")

// const fastify_plugin = require("fastify-plugin")

const app_play = fastify.fastify({maxParamLength: 256, trustProxy: ['loopback', 'linklocal', 'uniquelocal']})

app_play.register(fastify_static, {
    root: path.resolve(config.streams_path.replace(/\(pathname\)/g, __dirname + "/../")),
    serve: false
})

app_play.register(fastify_static, {
    root: path.resolve(config.dvr_path.replace(/\(pathname\)/g, __dirname + "/../")),
    prefix: "/dvr/",
    decorateReply: false,
    index: false
})

app_play.register(fastify_static, {
    root: path.resolve(path.join(__dirname, '/../tests/')),
    prefix: "/test/",
    decorateReply: false,
    index: false    
})

app_play.register(fastify_cors, {
    exposedHeaders: ["X-Cluster-ID"]
})

app_play.addHook('onSend', function (req, res, payload, next) {
    if (req.url.startsWith("/dvr/")) {
        if (res.getHeader('content-type') === 'application/vnd.apple.mpegurl') {
            res.header('Content-Type', 'application/x-mpegurl')
        }
    }
    next()
})

/*
app_play.get("/dvr/:stream/:file", async (req, res) => {
    const file_path = req.params.file

    res.header("x-playback-worker", process.pid)

    if (file_path.endsWith(".ts")) {
        const have_stream = await dvr.query().where("dvr_id", "=", req.params.stream)
        if (have_stream.length <= 0) {
            return res.status(404).send({error: "This stream is non-existent."})
        }

        const streams_path = `${config.dvr_path.replace(/\(pathname\)/g, __dirname)}/${req.params.stream}/`
        if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).send({error: "This stream is not available."})
        if (!fs_sync.existsSync(`${streams_path}/${file_path}`)) return res.status(404).send({error: "Not found"})

        return res.status(200).sendFile(`${req.params.stream}/${file_path}`)                          
    } else if (file_path.endsWith(".m3u8")) {
        const have_stream = await dvr.query().where("dvr_id", "=", req.params.stream)
        if (have_stream.length <= 0) {
            return res.status(404).send({error: "This stream is non-existent."})
        }

        const streams_path = `${config.dvr_path.replace(/\(pathname\)/g, __dirname)}/${req.params.stream}/`
        if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).send({error: "This stream is not available."})

        try {
            const hls_ts_file = await fs.readFile(`${streams_path}/${file_path}`, {encoding: "utf-8"})

            return res.status(200).header("Content-Type", "application/x-mpegurl").send(hls_ts_file.replace(/\r/g, ""))
        } catch (e) {            
            if (e.code == "ENOENT") {
                res.status(404).send({error: "Not found"})
            } else {
                console.trace(e)
                res.status(500).send({error: e})
            }         
        }

    } else {
        return res.status(403).send({error: "Not OTT content"})
    }
})
*/

app_play.get("/play/:stream/:file/:file2?", async (req, res) => {
    const file_path = req.params.file+(req.params.file2 ? ("/"+req.params.file2) : "")

    res.header("x-playback-worker", process.pid)

    if (file_path.endsWith(".ts")) {
        const have_stream = await streams.query().where("stream_id", "=", req.params.stream)
        if (have_stream.length <= 0) {
            return res.status(404).send({error: "This stream is non-existent."})
        }

        const streams_path = `${path.resolve(config.streams_path.replace(/\(pathname\)/g, __dirname+"/../"))}/${req.params.stream}/`
        if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).send({error: "This stream is not available."})
        if (!fs_sync.existsSync(`${streams_path}/${file_path}`)) return res.status(404).send({error: "Not found"})

        return res.status(200).sendFile(`${req.params.stream}/${file_path}`)                          
    } else if (file_path.endsWith(".m3u8")) {
        const have_stream = await streams.query().where("stream_id", "=", req.params.stream)
        if (have_stream.length <= 0) {
            return res.status(404).send({error: "This stream is non-existent."})
        }

        const streams_path = `${path.resolve(config.streams_path.replace(/\(pathname\)/g, __dirname+"/../"))}/${req.params.stream}/`
        if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).send({error: "This stream is not available."})

        try {
            const hls_ts_file = await fs.readFile(`${streams_path}/${file_path}`, {encoding: "utf-8"})

            return res.status(200).header("Content-Type", "application/x-mpegurl").send(hls_ts_file.replace(/\r/g, "").replace(/#EXT-X-MEDIA-SEQUENCE/g, `#EXT-X-PLAY-ON:DTVAnywhere\n#EXT-X-STREAM-NAME:${have_stream[0].name}\n#EXT-X-STREAM-SOURCE:${have_stream[0].type}\n#EXT-X-STREAM-HOSTNAME:${os.hostname()}\n#EXT-X-MEDIA-SEQUENCE`))
        } catch (e) {            
            if (e.code == "ENOENT") {
                res.status(404).send({error: "Not found"})
            } else {
                console.trace(e)
                res.status(500).send({error: e})
            }         
        }

    } else {
        return res.status(403).send({error: "Not OTT content"})
    }
})

const geo_params = JSON.parse(process.env.geo_params)

app_play.get("/manifest.json", async (req, res) => {
    res.header("x-playback-worker", process.pid)

    return res.status(200).send({
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

app_play.get("/playlist.m3u", async (req, res) => {
    const streams_ = await streams.query().where("active", "=", true)
    var streams_out = []
    var m3u = "#EXTM3U\n"

    res.header("x-playback-worker", process.pid)

    for (let i = 0; i<streams_.length; i++) {
        const stream = streams_[i]
        if (stream.type === "dtv") {
            const sp = JSON.parse(stream.params)
            var ch_mux = []
            for (let j = 0; j<sp.channels.length; j++) {
                const st_channel = sp.channels[j]
                m3u += `#EXTINF:-1 tvg-id="${stream.stream_id}-${st_channel.id}",${st_channel.name}\n${req.protocol}://${req.headers["x-forwarded-prefix"] ? req.headers["x-forwarded-prefix"] : (req.headers.host+'/play')}/${stream.stream_id}/${st_channel.id}/index.m3u8\n`
            }
        } else {
            m3u += `#EXTINF:-1 tvg-id="${stream.stream_id}",${stream.name}\n${req.protocol}://${req.headers["x-forwarded-prefix"] ? req.headers["x-forwarded-prefix"] : (req.headers.host+'/play')}/${stream.stream_id}/index.m3u8\n`
        }
    }
    return res.status(200).header("Content-Type", "application/x-mpegurl").send(m3u)
})

app_play.get("/api/streams", async (req, res) => {
    const streams_ = await streams.query().where("active", "=", true)

    res.header("x-playback-worker", process.pid)

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
    return res.status(200).send(streams_out)
});

/*
app_play.get("/manifest.json", cors(), async (req, res) => {
    return res.status(200).json({
        name: config.name,
        hostname: os.hostname(),
        server_uptime: os.uptime(),
        os_name: `${os.type()} ${os.release()}`,
        num_streams: (await streams.query()).length,
        country: geo_params.country,
        region_id: geo_params.region_id,
        dtv_area: geo_params.dtv_area
    })
})
*/

module.exports = {
    run: () => app_play.listen({port: config.play_port, host: "::"}, (e) => {
        if (e) {
            console.trace(e); 
            return
        }
        console.log(`worker ${process.env.cluster_id}-${process.pid} has been started`)
        if (!config.dtv_forward_key) return
        if (config.dtv_protocol == "frp" && process.env.cluster_id == 1) {
            setTimeout(() => {
                // frp_cp = cp.spawn(path.join(__dirname, "/bin/frpc"), ["http", "-l", config.play_port, "-s", config.dtv_forward_host, "-u", config.dtv_forward_key, "-n", crypto.randomBytes(128).toString("hex"), "--log_level", "error", "--ue"])
                frp_cp = cp.spawn(path.resolve(path.join(__dirname, "../bin/frpc")), ["http", "-l", config.play_port, "-s", config.dtv_forward_host, "-u", config.dtv_forward_key, "-n", crypto.randomBytes(128).toString("hex"), "--log_level", "error", "--http_user", config.dtv_forward_host.split(":")[0]])
                
                frp_cp.stderr.pipe(process.stderr)
                frp_cp.stdout.pipe(process.stdout)
            }, 2000)
        } else if (config.dtv_protocol == "frps" && process.env.cluster_id == 1) {
            setTimeout(() => {
                // frp_cp = cp.spawn(path.join(__dirname, "/bin/frpc"), ["http", "-l", config.play_port, "-s", config.dtv_forward_host, "-u", config.dtv_forward_key, "-n", crypto.randomBytes(128).toString("hex"), "--log_level", "error", "--ue"])
                frp_cp = cp.spawn(path.resolve(path.join(__dirname, "../bin/frpc")), ["http", "--tls_enable", "-l", config.play_port, "-s", config.dtv_forward_host, "-u", config.dtv_forward_key, "-n", crypto.randomBytes(128).toString("hex"), "--log_level", "error", "--http_user", config.dtv_forward_host.split(":")[0]])
                
                frp_cp.stderr.pipe(process.stderr)
                frp_cp.stdout.pipe(process.stdout)
            }, 2000)
        }
    })
}