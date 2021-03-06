
/**
 * Module dependencies.
 */

var os = require("os");
var fs = require("fs");
var util = require("util");
var express = require("express");
var jade = require("jade");
var app = module.exports = express();
var http = require("http");
var url = require("url");
var path = require("path");
var mdns = require("mdns");
var ws = require("ws");
var _ = require("underscore");
var mxutils = require("./mxutils");

// Command line arguments

var nopt = require("nopt");

var knownOpts = { "logfile" : path };
var parsed = nopt(knownOpts, { }, process.argv, 2)


var Log = require("log");
var log = new Log("debug",
                  parsed.hasOwnProperty("logfile")
                  ? fs.createWriteStream(parsed.logfile)
                  : process.stderr);

global.log = log;      // too much trouble to pass this around everywhere

// Configuration

app.configure(function() {
    app.set("views", __dirname + "/views");
    app.set("view engine", "jade");
    app.use(express.urlencoded());
    app.use(express.json());
    app.use(express.methodOverride());
    app.use(express.cookieParser());
});

app.configure("development", function() {
    app.locals.pretty = true;
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
    app.use(express.static(__dirname + "/public"));
});

app.configure("production", function() {
    app.use(express.errorHandler());
    app.use(express.compress());
    app.use(express.static(__dirname + '/public', {maxAge: 18 * 24 * 60 * 60 }));

    // we only minify in production
    var assetManager = require("connect-assetmanager");

    var assetManagerGroups = {
        "js" : {
            "route" : new RegExp("/js/all.js"),
            "path" : __dirname + "/public/js/",
            "dataType" : "javascript",
            "stale" : true,
            "files" : [
                "jquery-2.0.3.js",
                "jquery-ui-1.10.2.custom.js",
                "json2.js",
                "history.options.js",
                "history.js",
                "history.adapter.jquery.js",
                "jquery.cookie.js",
                "lightbox.js",
                "dummy-runtime.js",
                "dummy-templates.js",
                "mythexpress.js"
            ],
            "preManipulate" : {
                "^" : [
                    function (file, path, index, isLast, callback) {
                        // runtime and templates are dynamically generated
                        if (path.substr(-19) == "js/dummy-runtime.js") {
                            callback(mxutils.jadeRuntime());
                        } else if (path.substr(-21) == "js/dummy-templates.js") {
                            callback(mxutils.clientSideTemplates());
                        } else {
                            callback(file);
                        }
                    }
                ]
            },
        },
        "browser" : {
            "route" : new RegExp("/css/dark-hive/browser.css"),
            "path" : __dirname + "/public/css/",
            "dataType" : "css",
            "stale" : true,
            "files" : [
                "HTML5Reset.css",
                "dark-hive/jquery-ui-1.10.2.custom.css",
                "lightbox.css",
                "mythexpress.css",
                "browser.css"
            ]
        },
        "webapp" : {
            "route" : new RegExp("/css/dark-hive/webapp.css"),
            "path" : __dirname + "/public/css/",
            "dataType" : "css",
            "stale" : true,
            "files" : [
                "HTML5Reset.css",
                "dark-hive/jquery-ui-1.10.2.custom.css",
                "lightbox.css",
                "mythexpress.css",
                "webapp.css"
            ]
        }
    };

    app.use(assetManager(assetManagerGroups));
});

app.sendHeaders = function (req, res) {
    var context = res.locals.Context;
    for (var key in context)
        res.header("X-MX-" + key, encodeURIComponent(context[key]));
    res.header("Cache-Control", "no-cache");
};


var frontPage = require("./frontpage");
app.use(frontPage);


// Routes

require("./boot")({ app       : app,
                    jade      : jade,
                    url       : url,
                    os        : os,
                    fs        : fs,
                    util      : util,
                    __dirname : __dirname,
                    MX        : function (req, res, next) { next(); },
                    frontends : new (require("./mythtv/frontends.js")),
                    "_"       : _,
                    mxutils   : mxutils,
                    log       : log
                  });

if (app.settings.env === "development") {
    app.post("/log", function (req, res) {
        if (req.body.hasOwnProperty("msg"))
            log.info("Client: " + req.body.msg);
        res.send(200);
    });
}

GLOBAL.appEnv = app.settings.env || "development";


// Server

var websocket;
var webserver = http.createServer(app)
    .listen(process.env["MX_LISTEN"] || 6565,
            function () {
                log.info("create a socket server on:");
                log.info(webserver.address());
                websocket = new ws.Server({ server : webserver });

                log.info("MythTV Express server listening on port %d in %s mode",
                            webserver.address().port, app.get("env") || "development");

                // MythTV model

                var mythArgs = {
                    app : app,
                    websocket : websocket,
                    ws : ws,
                    log : log
                };
                if (process.env["MX_AFFINITY"]) {
                    mythArgs.affinity = process.env["MX_AFFINITY"];
                }

                app.mythtv = require("./mythtv")(mythArgs);

                // Tell the world we're here

                var ad = mdns.createAdvertisement(mdns.tcp("http"),
                                                  webserver.address().port,
                                                  {
                                                      name : "MythExpress on " + os.hostname()
                                                  });
            });
