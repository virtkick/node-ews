require('should');
var assert = require('chai').assert;

var Promise = require('bluebird').Promise;

var WebSocket = require('./ews');

describe('ews module', function() {
  var ws, wss, wsServer;

  beforeEach(function(cb) {
    ws = new WebSocket('ws://localhost:23200', {
      protocolVersion: 8,
      origin: 'http://localhost'
    });
    wss = new WebSocket.Server({ port: 23200 });

    wss.on('connection', function(ws) {
      wsServer = ws;
    });
    ws.on('open', cb);
  });
  afterEach(function() {
    if(wss) {
      wss.close();
    }
    assert.deepEqual(ws.requestMap, {});
    assert.deepEqual(wsServer.requestMap, {});
  });

  it('should work with casual web socket usage', function(endTest) {
    ws.send('test');
    ws.on('message', function(msg) {
      msg.should.equal('test-reply');
      endTest();
    });

    wsServer.on('message', function(msg) {
      wsServer.send('test-reply');
    })
  });

  it('should send JSON requests through basic API', function(endTest) {
    ws.sendRequest('test1', {code: 42}, function(err, res) {
      res.should.equal('foo');

      ws.sendRequest('test2', {code: 43}).then(function(res) {
        res.should.equal('foo2');
        endTest();
      });
    });

    wsServer.on('request:test1', function(data, responseCb) {
      data.code.should.equal(42);
      responseCb(null, 'foo');
    });
    wsServer.on('request:test2', function(data, responseCb) {
      data.code.should.equal(43);
      responseCb(null, 'foo2');
    });
  });

  it('should send JSON requests through promise request handlers',
    function(endTest) {
    ws.sendRequest('test1', {code: 42}, function(err, res) {
      res.should.equal('foo');

      ws.sendRequest('test2', {code: 43}).then(function(res) {
        res.should.equal('foo2');
        endTest();
      });
    });

    wsServer.onRequest('test1', function(data) {
      return 'foo';
    });
    wsServer.onRequest('test2', function(data) {
      return (new Promise(function(resolve, reject) {
        setTimeout(function() {
          resolve('foo2');
        }, 10);
      }));
    });
  });

  it('should send exceptions requests through promise handlers', function(endTest) {
    ws.sendRequest('test', {code: 42}, function(err, res) {
      err.should.equal("foo");
      endTest();
    });
    wsServer.onRequest('test', function(data) {
      throw "foo";
    });
  });

  it('should handle timeout errors', function(endTest) {
    ws.setResponseTimeout(10);

    var gotTimeout = false;

    ws.sendRequest('test1', {code: 42}).then(function(res) {
      res.should.equal('foo');
    }).catch(Promise.TimeoutError, function(err) {
      gotTimeout = true;
      err.message.should.equal('operation timed out');
    });

    wsServer.onRequest('test1', function(data) {
      return Promise.delay(20).then(function() {
        if(gotTimeout)
          endTest();
        return 'foo';
      });
    });
  });

  it('should send events', function(endTest) {
    ws.sendEvent('test', {
      code: 'foo'
    });

    wsServer.onEvent('test', function(data) {
      data.code.should.equal('foo');
      endTest();
    });
  });

  it('should not send events when removed', function(endTest) {
    ws.sendEvent('test', {
      code: 'foo'
    });

    wsServer.onEvent('test', function(data) {
      assert(false, 'Should not happen');
    });

    wsServer.offEvent('test');
    setTimeout(function() {
      endTest();
    }, 10);
  });

  it('should handle errors inside message handler', function(endTest) {
    ws.sendEvent('test');

    var tmp = console.error;
      console.error = function(msg) {
    };
    wsServer.on('message', function(msg) {
      throw new Error('test error');
    });

    wsServer.onEvent('test', function() {
      console.error = tmp;
      endTest();
    });
  });

  it('should emit close events', function(endTest) {
    wss.close();
    wsServer.on('close', function() {
      endTest();
    });
  });
});