module.exports = {
    apps: [{
        name: "gorillacleaner",
        script: "index.js",
        watch: ["index.js", "config.json"],
        ignore_watch: ["node_modules"],
        watch_delay: 1000
    }]
};