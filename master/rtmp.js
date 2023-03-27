const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const cp = require("child_process")
const nms = require("node-media-server")
const config = require("../config.json")

const streams = require("../db/streams");

var RTMPStreamID = {};
var RTMPServer;

module.exports = {
    start: () => {
        RTMPServer = new nms({
            rtmp: config.rtmp_settings,
            logType: 1
        })

        RTMPServer.on('prePlay', async (id, StreamPath, args) => {
            let sid = RTMPServer.getSession(id)    
            if (!StreamPath.startsWith("/live/")) return sid.reject()
            let stream_id = /\/live\/([\s\S]*)/g.exec(StreamPath)    
            if (!stream_id) return sid.reject()
            stream_id = stream_id[1]
            const rtmp_streams = await streams.query().where("type","=","rtmp")
            let found = false
            let found_id = ""    
            for (let i = 0; i<rtmp_streams.length; i++) {
                const rtmp_params = JSON.parse(rtmp_streams[i].params)                
                if (rtmp_params.rtmp_key == stream_id) {
                    found = true
                    found_id = rtmp_streams[i].stream_id
                    break
                }
            }
            if (!found) return sid.reject() 
            if (RTMPStreamID[found_id] != args.token) {
                return sid.reject()
            }
        });
        
        RTMPServer.on('prePublish', async (id, StreamPath, args) => {
            let sid = RTMPServer.getSession(id)    
            if (!StreamPath.startsWith("/live/")) return sid.reject()
            let stream_id = /\/live\/([\s\S]*)/g.exec(StreamPath)    
            if (!stream_id) return sid.reject()
            stream_id = stream_id[1]
            const rtmp_streams = await streams.query().where("type","=","rtmp")
            let found = false
            let found_id = ""    
            let passthrough = false
        
            for (let i = 0; i<rtmp_streams.length; i++) {
                const rtmp_params = JSON.parse(rtmp_streams[i].params)                
                if (rtmp_params.rtmp_key == stream_id) {
                    found = true
                    found_id = rtmp_streams[i].stream_id
                    passthrough = rtmp_params.passthrough !== undefined ? rtmp_params.passthrough : false
                    break
                }
            }
            if (!found) return sid.reject()    
            
            const out_path = `${path.resolve(config.streams_path.replace(/\(pathname\)/g, __dirname+"/../"))}/${found_id}/`
            await fs.mkdir(out_path, {recursive: true})
            const cur_proc = cp.fork(path.resolve(path.join(__dirname, "/../scripts/rtmp.js")))
        
            cur_proc.on("message", (d) => {        
                if (!d.retry) {
                    try {
                        delete StreamDTVJobs[found_id]
                        delete StreamDTVOutput[found_id]
                        delete RTMPStreamID[found_id]
                        sid.reject()   
                    } catch (e) {
                        
                    }
                }     
            })
            StreamDTVJobs[found_id] = cur_proc
            RTMPStreamID[found_id] = crypto.randomBytes(32).toString("hex")
        
            cur_proc.send({
                ffmpeg: config.ffmpeg, 
                rtmp_id: stream_id,
                stream_id: found_id,
                rtmp_port: config.rtmp_settings.port,
                rtmp_token_id: RTMPStreamID[found_id],
                type: "rtmp",
                output_path: out_path, 
                renditions_hd: config.renditions_hd, 
                renditions_sd: config.renditions_sd, 
                multiple_renditions: config.multiple_renditions, 
                hls_settings: config.hls_settings,
                passthrough: passthrough
            })
        });
        
        RTMPServer.on('donePublish', async (id, StreamPath, args) => {
            let sid = RTMPServer.getSession(id)    
            if (!StreamPath.startsWith("/live/")) returnd.stream_id
            let stream_id = /\/live\/([\s\S]*)/g.exec(StreamPath)    
            if (!stream_id) return
            stream_id = stream_id[1]
            const rtmp_streams = await streams.query().where("type","=","rtmp")
            let found = false
            let found_id = ""    
            for (let i = 0; i<rtmp_streams.length; i++) {
                const rtmp_params = JSON.parse(rtmp_streams[i].params)                
                if (rtmp_params.rtmp_key == stream_id) {
                    found = true
                    found_id = rtmp_streams[i].stream_id
                    break
                }
            }
            if (!found) return 
        
            if (StreamDTVJobs[found_id]) StreamDTVJobs[found_id].send({quit: true, stream_id: found_id})
        });
    }
}