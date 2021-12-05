//Read Config
require('dotenv').config()

var fs = require('fs');
var util = require('util');
var logFile = fs.createWriteStream(__dirname + process.env.LOGS_LOCATION, {flags : 'w'});

//Setup TCP Server
var tcpNet = require('net');
var tcpServer = tcpNet.createServer();    
tcpServer.on('connection', handleConnection);

tcpServer.listen(process.env.CONTROLLER_PORT, function() {    
  console.log('server listening to %j', tcpServer.address());  
});

var botHash = {};
var runningHash = {
	botsRunning: 0
};
//var  cleanBotsTimer = setInterval(cleanDeadBots,process.env.CLEANBOTS_TIMER);

var moveHash = {};

function handleConnection(conn) {    
  var remoteAddress = conn.remoteAddress + ':' + conn.remotePort;  
  console.log('new client connection from %s', remoteAddress);
  conn.on('data', onConnData);  
  //conn.once('close', onConnClose);  
  conn.on('error', onConnError);
  function onConnData(d) {  
  	var decodedData = d.toString('utf-8')
  	var dataHash = JSON.parse(decodedData);
  	//console.log(dataHash);
    //console.log('connection data from %s: %j', remoteAddress, decodedData);  
    //conn.write(d,"utf-8");
    if(dataHash['dataType'] === "botInfo"){
    	if(dataHash.botHostLoad1m >= 10){
    		console.log(dataHash.botHost+" "+dataHash.botPID+" "+dataHash.botCoresAvailable+" "+dataHash.botHostLoad1m+" "+dataHash.botHostLoad5m+" "+dataHash.botHostLoad15m);
    		console.log("System Load Too High");
    		console.log("Refusing to Start");
    		conn.once('close', onConnClose);
    	}else{
    		var sendJSON = {function:"StartGame", STOCKFISH_DEPTH: process.env.STOCKFISH_DEPTH, STOCKFISH_NODES:process.env.STOCKFISH_NODES, STOCKFISH_THREADS:process.env.STOCKFISH_THREADS}
    		conn.write(JSON.stringify(sendJSON));
    	}
    	if(!botHash[dataHash['botHost']]){
    		botHash[dataHash['botHost']] = {}
    	}
    	 if(!botHash[dataHash['botHost']][dataHash['botPID']]){
    		botHash[dataHash['botHost']][dataHash['botPID']] = dataHash
    	}
    }
    if(dataHash['dataType'] === "heartbeat"){

  		botHash[dataHash['botHost']][dataHash['botPID']]['heartbeatDiff'] = Date.now() - botHash[dataHash['botHost']][dataHash['botPID']]['botLastHeartbeat'];
    	botHash[dataHash['botHost']][dataHash['botPID']]['botLastHeartbeat'] = Date.now()
    	//console.log(botHash); 

    }
    if(dataHash['function'] === "processMove"){
    	console.log("Process Move")
    	console.log(dataHash);

    }
    //console.log(runningHash);
  }
  function onConnClose() {  
    console.log('connection from %s closed', remoteAddress);  
  }
  function onConnError(err) {  
    console.log('Connection %s error: %s', remoteAddress, err.message);  
  }  
}


function processGame(){



}

function cleanDeadBots(){
	for (const [hostKey, hostValue] of Object.entries(botHash)) {
		console.log("---------------------------- Clean Bots")
		//console.log(hostKey,hostValue)
		for (const [botKey, botValue] of Object.entries(hostValue)) {
			console.log(botKey,botValue);
			botHash[hostKey][botKey]['heartbeatDiff'] = Date.now() - botHash[hostKey][botKey]['botLastHeartbeat'];
			console.log(botHash[hostKey][botKey]['heartbeatDiff']);
			if(botHash[hostKey][botKey]['heartbeatDiff'] > 10000){
				console.log("Stale Bot. Log and Remove");
				botValue.status = "StaleBot"
				logFile.write(JSON.stringify(botValue)+"\n");
				delete botHash[hostKey][botKey];
			}

		}
		console.log("Cleaned Bot Hjash:",botHash);
	}

}