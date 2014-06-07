var fs = require('fs');
var http = require('http');
var socketIO = require('socket.io');
var express = require('express');
var mysql = require('mysql');

require('array.from');


var config = JSON.parse(fs.readFileSync('config.json'));


// Object.keys polyfill https://gist.github.com/atk/1034464
Object.keys = Object.keys || 
    function ( 
        o, // object
        k, // key
        r  // result array
    ) {
        // initialize object and result
        r=[];
        // iterate over object keys
        for (k in o) {
            // fill result array with non-prototypical keys
            if(r.hasOwnProperty.call(o, k)) r.push(k);
        }
        // return result
        return r;
    };


/*
var sql = mysql.createConnection({
	'host': config.sql.host,
	'user': config.sql.user,
	'password': config.sql.password
});
*/
var sql;
function connectSql() {
	sql = mysql.createConnection(config.sql.connectionOptions);

	sql.connect(function(err) {
		if(err) {
			console.log('Error connecting to SQL DB: ', err);
			setTimeout(connectSql, 2000);
		}
	});

	sql.on('error', function(err) {
		console.log('sql db error: ', err);
		if(err.code === 'PROTOCOL_CONNECTION_LOST') {
			connectSql();
		} else {
			throw err;
		}
	});
}

connectSql();


/*
sql.query('USE manny', function(err, rows, fields) {
	if(err) console.log('SQL "USE manny" err ', err);
});
*/




var app = express();
var httpServer = http.createServer(app);
var socketIOServer = socketIO.listen(httpServer);
httpServer.listen(config.port);


function tryCall() {
	arguments = Array.from(arguments);
	if(arguments[0] && typeof arguments[0] === 'function') {
		arguments[0].apply(this, arguments.slice(1));
	}
} 

function lookupService(handleCommandData) {
	console.log("lookup service with data ", handleCommandData);
	var data = handleCommandData;
	console.log("lookup, serviceMap ", serviceMap);
	var serviceList = serviceMap[data.type];
	console.log("lookup, serviceList", serviceList);
	if(!serviceList) return undefined;

	return serviceList[0];
}

var serviceMap = {};


socketIOServer.set('log level', 1);
socketIOServer.sockets.on('connection', function(socket) {
	console.log('Socket connection');

	socket.on('disconnect', function() {
		// for each service type,
		Object.keys(serviceMap).forEach(function(serviceName) {
			serviceMap[serviceName] = serviceMap[serviceName].filter(function(service) {
				return service.socket !== socket;
			});
		});

		console.log('socket disconnected; new service map: ', serviceMap);
	});

	socket.on('announceNode', function(data, clientCallback) {
		console.log('announceNode', data);

		data.services.forEach(function(service) {
			//console.log(" = loop service ", service);
			if(!serviceMap[service]) serviceMap[service] = [];
			serviceMap[service].push({
				nodeContext: data.nodeContext,
				socket: socket,
				service: service
			});
		});

		tryCall(clientCallback);
		//console.log(" = serviceMap ", serviceMap);
	});

	socket.on('handleCommand', function(data, clientCallback) {
		console.log("Starting handleCommand");
		console.log(data);

		if(data.type == 'device') {
			// need to massage the stuff first
			var query = sql.query("SELECT * FROM devices WHERE room = ? AND name = ?", [data.room, data.deviceName], function(err, rows, fields) {
				//console.log('device query, err? ', err);
				//console.log('device query, rows', rows);
				if(rows.length === 0) {
					tryCall(clientCallback, {err: "No device found in " + data.room + " named " + data.deviceName});
					return;
				}
				var row = rows[0];
				data.type = row.serviceType; // devices-stephanie, devices-insteon
				data.stephaniePin = row.stephaniePin;
				data.insteonAddress = row.insteonAddress;

				postMassageData();
			});
			//console.log('device query ', query.sql);

		} else {
			postMassageData();
		}


		function postMassageData() {
			//find service socket
			var service = lookupService(data);

			if(service === undefined) {
				tryCall(clientCallback, {err: "No service provider found"});
				return;
			}

			service.socket.emit('handleCommand', data, function(data) {
				console.log('try callback');
				tryCall(clientCallback, data);
			});
			console.log('post emit acks: ', service.socket.acks);
		}
	});

	socket.on('getDeviceList', function(data, clientCallback) {
		console.log('getDeviceList');
		sql.query('SELECT * FROM devices', function(err, rows, fields) {
			console.log(' err?', err);

			tryCall(clientCallback, {devices: rows});
		});
	});
});



// Express /////////////////////////
app.use(express.bodyParser());
app.use(express.cookieParser());
//app.use(express.session({ secret: "something", store: mongoStore }));

app.use(express.static(__dirname + '/public', {maxAge: 1}));