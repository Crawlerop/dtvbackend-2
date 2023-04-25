const path = require("path");
const fs = require("fs/promises");
const cp = require("child_process")

const config = require("../config.json");
const dvr = require("./dvr");

var StreamDTVJobs = {};
var StreamDTVOutput = {};

module.exports = {
    addDTVJobs: function (stream_id, type, params, name="") {
        if (type == "rtmp") return;
        const out_path = path.resolve(`${config.streams_path.replace(/\(pathname\)/g, __dirname+"/../")}/${stream_id}/`)
        fs.mkdir(out_path, {recursive: true}).then(() => {
            const cur_proc = cp.fork(path.resolve(path.join(__dirname, "/../scripts/"+type+".js")))
            if (type == "dvb2ip") {
                cur_proc.send({
                    ffmpeg: config.ffmpeg, 
                    src: params.src, 
                    src_id: params.src_id,
                    stream_id: stream_id,
                    name: name,
                    type: type,
                    output_path: out_path, 
                    renditions_hd: config.renditions_hd, 
                    renditions_sd: config.renditions_sd, 
                    multiple_renditions: config.multiple_renditions, 
                    hls_settings: config.hls_settings,
                    additional_params: params.additional_params,
                    buffer_size: config.dtv_buffer_size,
                    watermark: config.watermark_ignore_streams.indexOf(stream_id) !== -1 ? "" : config.watermark,
                    pathname: path.resolve(__dirname + "/../")
                })
            } else if (type == "dtv") {
                cur_proc.send({
                    ffmpeg: config.ffmpeg, 
                    tuner: params.tuner,
                    frequency: params.frequency,
                    channels: params.channels,
                    stream_id: stream_id,
                    type: type,
                    output_path: out_path, 
                    renditions_hd: config.renditions_hd, 
                    renditions_sd: config.renditions_sd,  
                    multiple_renditions: config.multiple_renditions, 
                    hls_settings: config.hls_settings,
                    dtv_use_fork: config.dtv_use_fork,
                    dtv_udp_out: config.dtv_udp_out,
                    use_protocol: config.use_protocol,
                    dtv_tcp_use_copy: config.dtv_tcp_use_copy,
                    additional_params: params.additional_params,
                    buffer_size: config.dtv_buffer_size,
                    dtv_ignore_map: config.dtv_ignore_map,
                    dtv_force_hd: config.dtv_force_hd,
                    system: params.system ? params.system : "DVB-T2",
                    watermark: config.watermark,
                    watermark_ignore_streams: config.watermark_ignore_streams,
                    pathname: path.resolve(__dirname + "/../"),
                    do_scale: config.nvdec_use_scale,
                    do_scale_exclude: config.nvdec_scale_exclude,
                    do_sw_decode: config.nvdec_sw_decode
                })
            } else if (type == "pull") {
                cur_proc.send({
                    ffmpeg: config.ffmpeg, 
                    src: params.source,  
                    realtime: params.realtime,                   
                    passthrough: params.passthrough,
                    stream_id: stream_id,
                    type: type,
                    output_path: out_path, 
                    renditions_hd: config.renditions_hd, 
                    renditions_sd: config.renditions_sd, 
                    multiple_renditions: config.multiple_renditions, 
                    hls_settings: config.hls_settings,
                    watermark: config.watermark_ignore_streams.indexOf(stream_id) !== -1 ? "" : config.watermark,
                    pathname: path.resolve(__dirname + "/../")
                })
            }
            cur_proc.on("message", (d) => {
                if (d.retry) {
                    console.log("stream has encountered an error, retrying.")  
                    console.trace(d)
                    try {              
                        StreamDTVJobs[d.stream_id].kill("SIGKILL")
                    } catch (e) {}
                    setTimeout(() => {
                        fs.rm(`${path.resolve(config.streams_path.replace(/\(pathname\)/g, __dirname+"/../"))}/${d.stream_id}/`, {force: true, recursive: true}).catch(console.trace).finally(() => this.addDTVJobs(d.stream_id, d.type, d.params, d.name))                        
                    }, 5000)
                } else {            
                    delete StreamDTVJobs[d.stream_id]     
                    delete StreamDTVOutput[d.stream_id]                           
                }
            })
            StreamDTVJobs[stream_id] = cur_proc
        }).catch((e) => {
            console.trace(e)
        })
    },
    forceStop: async () => {
        for (job of StreamDTVJobs) {
            job.kill("SIGKILL")
            try {
                await fs.rm(StreamDTVOutput[k], {force: true, recursive: true})
            } catch (e) {}
        }
    },
    removeDTVJobs: (stream_id, stream) => {
        if (StreamDTVJobs[stream_id]) StreamDTVJobs[stream_id].send({quit: true, stream_id: stream_id})        
        dvr.abort(stream_id, stream)
    }
}