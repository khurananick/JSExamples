var https   = require('https');
var http    = require('http');
var url     = require('url');
var fs      = require('fs');
var proxy   = require('http-proxy');
var request = require('request');
var redis   = require("redis");
var client  = redis.createClient({ port: '6379' });

https.globalAgent.maxSockets = 999;
http.globalAgent.maxSockets = 999;

// Define the servers to load balance.
var servers = [
  {host: '192.241.166.198', port: 80},
  {host: '192.241.166.190', port: 80},
];
var failoverTimer = [];

// Load the SSL cert.
var read = fs.readFileSync;
var opts = {
  key: read(__dirname + '/ssl/websockets.appkat.com.key', 'utf8'),
  cert: read(__dirname + '/ssl/websockets_appkat_com.crt', 'utf8'),
  ca: [
    read(__dirname + '/ssl/AddTrustExternalCARoot.crt', 'utf8'),
    read(__dirname + '/ssl/COMODORSAAddTrustCA.crt'),
    read(__dirname + '/ssl/COMODORSADomainValidationSecureServerCA.crt', 'utf8')
  ]
};

// Create a proxy object for each target.
var proxies = servers.map(function (target) {
  return new proxy.createProxyServer({
    target: target,
    ws: true,
    xfwd: true,
    ssl: opts
  });
});

/**
 * Select a random server to proxy to. If a 'server' cookie is set, use that
 * as the sticky session so the user stays on the same server (good for ws fallbacks).
 * @param  {Object} req HTTP request data
 * @param  {Object} res HTTP response
 * @return {Number}     Index of the proxy to use.
 */
var selectServer = function(req, res, index) {
  // Select a random server if they don't have a sticky session.
  if(typeof index === 'undefined' || (index === false && index !== "0")) {
    req.allownextifdown = true;
    index = Math.floor(Math.random() * proxies.length);
    if(req.roomname) client.set(req.roomname, index);
  }

  // If the selected server is down, select one that isn't down.
  // In case of joining an RTC convo, don't change down server.
  if(proxies[index].options.down && req.allownextifdown) {
    index = -1;
    var tries = 0;
    while (tries < 5 && index < 0) {
      var randIndex = Math.floor(Math.random() * proxies.length);
      if (!proxies[randIndex].options.down) {
        index = randIndex;
      }
      tries++;
    }
  }

  return index;
};

// for each web request, selects server and proxies request.
var proxyWebRequest = function(req,res,index) {
  var proxyIndex = selectServer(req, res, index);
  var proxy = proxies[proxyIndex];
  proxy.web(req, res);
  proxy.on('error', function(err) {
    startFailoverTimer(proxyIndex);
  });
};

// for each socket request, selects server and proxies request.
var proxyWebSocketRequest = function(req,socket,head,index) {
  var proxyIndex = selectServer(req, null, index);
  var proxy = proxies[proxyIndex];
  proxy.ws(req, socket, head);
  proxy.on('error', function(err, req, socket) {
    socket.end();
    startFailoverTimer(proxyIndex);
  });
};

// finds the server with application that contains easyrtcid.
var findProxyServer = function(req,res,callback) {
  var curIndex=0;
  var proxyIndex;
  var last = servers.length - 1;

  var sendPing = function(server) {
    http.get(server, function(resp) {
      if(resp.statusCode==202) {
        proxyIndex = curIndex;
        client.set(req.sid,curIndex);
        callback(req,res,curIndex);
      } else if (last == curIndex) {
        var i=0;
        while(i <= curIndex) {
          callback(req,res,i);
          i++;
        }
      } else {
        curIndex++;
        pingNextProxy();
      }
    });
  };

  var pingNextProxy = function() {
    if(!proxyIndex) {
      sendPing({ host: servers[curIndex].host, port: servers[curIndex].port, path:'/proxy/has_connection/'+req.sid});
    }
  };

  pingNextProxy();
};

/**
 * Fired when there is an error with a request.
 * Sets up a 10-second interval to ping the host until it is back online.
 * There is a 10-second buffer before requests start getting blocked to this host.
 * @param  {Number} index Index in the proxies array.
 */
var startFailoverTimer = function(index) {
  if (failoverTimer[index]) {
    return;
  }

  failoverTimer[index] = setTimeout(function() {
    // Check if the server is up or not
    request({
      url: 'http://' + proxies[index].options.target.host + ':' + proxies[index].options.target.port + '/api/status',
      method: 'HEAD',
      timeout: 10000
    }, function(err, res, body) {
      failoverTimer[index] = null;

      if (res && res.statusCode === 200) {
        proxies[index].options.down = false;
        console.log('Server #' + index + ' is back up.');
      } else {
        proxies[index].options.down = true;
        startFailoverTimer(index);
        console.log('Server #' + index + ' is still down.');
      }
    });
  }, 10000);
};

// Select the next server and send the http request.
var serverCallback = function(req, res) {
  var domain = req.headers.host;
  req.roomname = (function() {
    if(req.query && req.query.r) {
      return req.query.r;
    }
    else if(req.headers.cookie) {
      var roomNameCookie;
      var cookies = req.headers.cookie.split('; ');
      for (i=0; i<cookies.length; i++) {
        if (cookies[i].indexOf('roomName=') === 0) {
          roomNameCookie = cookies[i];
        }
      }
      if(roomNameCookie) {
        var value = roomNameCookie.substring(9, roomNameCookie.length);
        if (value && value !== "" && value.length > 10) {
          return value;
        }
      }
    }
    return false;
  })();

  /* request includes roomname */
  if(req.roomname) {
    client.get(req.roomname, function (err, index) {
      index = index ? index.toString() : false;
      res.setHeader('Set-Cookie', 'roomName=' + req.roomname + ';domain=.appkat.com;path=/');
      proxyWebRequest(req, res, index);
    });
  }
  else if(domain && domain.match(/websockets.appkat/)) {
    proxyWebRequest(req, res);
  }
  /* request is for a port forwarded over a websocket to an appkat subdomain. */
  else {
    var arr = domain.split('.');
    if(arr.length > 2) {
      req.sid = arr[0];
      client.get(req.sid, function (err, index) {
        index = index ? index.toString() : false;
        if(!index) {
          findProxyServer(req,res,function(req,res,index) {
            proxyWebRequest(req,res,index);
          });
        } else {
          proxyWebRequest(req,res,index);
        }
      });
    } else {
      proxyWebRequest(req,res);
    }
  }
};

var server = https.createServer(opts, serverCallback);
var server2 = http.createServer(serverCallback);

// Get the next server and send the upgrade request.
server.on('upgrade', function(req, socket, head) {
  req.roomname = (function() {
    if(req.query && req.query.r) {
      return req.query.r;
    }
    else if(req.headers.cookie) {
      var roomNameCookie;
      var cookies = req.headers.cookie.split('; ');
      for (i=0; i<cookies.length; i++) {
        if (cookies[i].indexOf('roomName=') === 0) {
          roomNameCookie = cookies[i];
        }
      }
      if(roomNameCookie) {
        var value = roomNameCookie.substring(9, roomNameCookie.length);
        if (value && value !== "" && value.length > 10) {
          return value;
        }
      }
    }
    return false;
  })();

  if(req.roomname) {
    client.get(req.roomname, function (err, index) {
      index = index ? index.toString() : false;
      proxyWebSocketRequest(req,socket,head,index);
    });
  }
  else {
    proxyWebSocketRequest(req,socket,head);
  }
});

server2.on('upgrade', function(req, socket, head) {
  req.roomname = (function() {
    if(req.headers.cookie) {
      var cookies = req.headers.cookie.split('; ');
      for (i=0; i<cookies.length; i++) {
        if (cookies[i].indexOf('roomName=') === 0) {
          var value = cookies[i].substring(9, cookies[i].length);
          if (value && value !== "" && value.length > 10) {
            return value;
          }
        }
      }
      return false;
    }
    else {
      return false;
    }
  })();

  if(req.roomname) {
    client.get(req.roomname, function (err, index) {
      index = index ? index.toString() : false;
      proxyWebSocketRequest(req,socket,head,index);
    });
  }
  else {
    proxyWebSocketRequest(req,socket,head);
  }
});

server.listen(443);
server2.listen(80);
