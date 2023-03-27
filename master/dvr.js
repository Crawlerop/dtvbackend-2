const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const cp = require("child_process")

const config = require("../config.json")
const dvr = require("../db/dvr")

var DVR_STREAMS = {}
var DVR_PROC = {}

module.exports = {
    start: async (stream_id, stream, program) => {
        if (stream.type == "dtv") {
            if (!program) {error: "A program id must be specified."}
    
            if (DVR_STREAMS[`${stream_id}/${program}`] === undefined) {
                DVR_STREAMS[`${stream_id}/${program}`] = crypto.randomBytes(64).toString("hex")
                DVR_PROC[DVR_STREAMS[`${stream_id}/${program}`]] = cp.fork(path.resolve(path.join(__dirname, "/../scripts/dvr.js")))
                DVR_PROC[DVR_STREAMS[`${stream_id}/${program}`]].send({
                    stream_id: stream_id,
                    channel: program,
                    target: DVR_STREAMS[`${stream_id}/${program}`]
                })
    
                await fs.mkdir(`${path.resolve(config.dvr_path.replace(/\(pathname\)/g, __dirname+"/../"))}/${DVR_STREAMS[`${stream_id}/${program}`]}`)
                return {error: null}
            } else {
                return {error: "Stream is already recording"}
            }
        } else {
            if (DVR_STREAMS[stream_id] === undefined) {
                DVR_STREAMS[stream_id] = crypto.randomBytes(64).toString("hex")
                DVR_PROC[DVR_STREAMS[stream_id]] = cp.fork(path.resolve(path.join(__dirname, "/../scripts/dvr.js")))
                DVR_PROC[DVR_STREAMS[stream_id]].send({
                    stream_id: stream_id,
                    channel: -1,
                    target: DVR_STREAMS[stream_id]
                })
    
                await fs.mkdir(`${path.resolve(config.dvr_path.replace(/\(pathname\)/g, __dirname+"/../"))}/${DVR_STREAMS[stream_id]}`)
                return {status: "OK"}
            } else {
                return {error: "Stream is already recording"}
            }
        }
    },
    stop: async (stream_id, stream, program) => {
        if (stream.type == "dtv") {
            if (!program) return {error: "A program id must be specified."}
    
            if (DVR_STREAMS[`${stream_id}/${program}`] !== undefined) {
                
                await dvr.query().insert({
                    stream_id: stream_id,
                    channel: program,
                    dvr_id: DVR_STREAMS[`${stream_id}/${program}`],
                    created_on: Date.now()
                })
                
                DVR_PROC[DVR_STREAMS[`${stream_id}/${program}`]].send({quit: true, abort: false})
                delete DVR_PROC[DVR_STREAMS[`${stream_id}/${program}`]]
                delete DVR_STREAMS[`${stream_id}/${program}`]
                return {error: null}
            } else {
                return {error: "Stream is not recording"}
            }
        } else {
            if (DVR_STREAMS[stream_id] !== undefined) {
                await dvr.query().insert({
                    stream_id: stream_id,
                    dvr_id: DVR_STREAMS[stream_id],
                    created_on: Date.now()
                })
    
                DVR_PROC[DVR_STREAMS[stream_id]].send({quit: true, abort: false})
                delete DVR_PROC[DVR_STREAMS[stream_id]]
                delete DVR_STREAMS[stream_id]
                return {error: null}
            } else {
                return {error: "Stream is not recording"}
            }
        }
    },
    abort: (stream_id, stream) => {
        if (stream.type === "dtv") {
            const TMP_DVR = DVR_STREAMS
            for (k in TMP_DVR) {
                if (k.startsWith(`${stream_id}/`)) {
                    DVR_PROC[DVR_STREAMS[k]].send({quit: true, abort: true})

                    delete DVR_PROC[DVR_STREAMS[k]]
                    delete DVR_STREAMS[k]
                }
            }
        } else if (DVR_PROC[DVR_STREAMS[`${stream_id}`]]) {
            DVR_PROC[DVR_STREAMS[`${stream_id}`]].send({quit: true, abort: true})

            delete DVR_PROC[DVR_STREAMS[`${stream_id}`]]
            delete DVR_STREAMS[`${stream_id}`]
        }
    },
    DVR_STREAMS,
    DVR_PROC
}