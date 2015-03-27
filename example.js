var WebSocket = require('./ews');
var Promise = require('bluebird').Promise;


var wsServer = new WebSocket.Server({ port: 23200 });

var ws = new WebSocket('ws://localhost:23200');


wsServer.on('connection', function(wsClient) {

	wsClient.sendRequest('config').then(function(config) {
		console.log('Got config', config);
	});

	setInterval(function() {
		wsClient.sendRequest('ping').then(function(data) {
			console.log('Got', data);
		});
	}, 1000)

	wsClient.onRequest('version', function() {
		return '1.0';
	});

	wsClient.sendEvent('testEvent', {data: 'test'});
});

ws.on('open', function() {
	ws.sendRequest('version').then(function(version) {
		console.log('version', version);
	});
});

ws.onRequest('config', function() {
	// you can return a promise here or a value
	return {
		key: 'value'
	};
});


ws.onRequest('ping', function() {
	return Promise.delay(100).then(function() {
		return 'pong'
	});
});

ws.onEvent('testEvent', function(ev) {
	console.log('Got event', ev);
});
