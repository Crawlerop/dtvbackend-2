const path = require("path");
const fs_sync = require("fs");

if (!fs_sync.existsSync(path.join(__dirname, "/upstream.db"))) {
    fs_sync.copyFileSync(path.join(__dirname, "/upstream-default.db"), path.join(__dirname, "/upstream.db"))
}

const Knex = require("knex")
const knex = Knex(require("./knexFile"))
const objection = require("objection");

objection.Model.knex(knex)

const defaultConfig = require("./utils/defaultConfig")

if (!fs_sync.existsSync(path.join(__dirname, "/config.json"))) fs_sync.writeFileSync(path.join(__dirname, "/config.json"), JSON.stringify(defaultConfig.config_defaults, null, 4))
const config = require("./config.json");
const cluster = require("cluster");

if (!fs_sync.existsSync(config.dvr_path.replace(/\(pathname\)/g, __dirname))) fs_sync.mkdirSync(config.dvr_path.replace(/\(pathname\)/g, __dirname), {recursive: true})

if (fs_sync.existsSync(config.streams_path.replace(/\(pathname\)/g, __dirname))) {
    fs_sync.rmSync(config.streams_path.replace(/\(pathname\)/g, __dirname), {force: true, recursive: true})
}

fs_sync.mkdirSync(config.streams_path.replace(/\(pathname\)/g, __dirname), {recursive: true})

const workersCount = require('os').cpus().length

if (!cluster.isPrimary) {
    require("./worker").run()
} else {
    require("./master").run().then((g) => {        
        for (let i = 0; i < workersCount; i++) {
            cluster.fork({cluster_id: i+1, geo_params: JSON.stringify(g)});
        }        
    })
}
