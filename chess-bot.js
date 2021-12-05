require('dotenv').config();
var md5 = require('md5');

const os = require("os");
var ps = require('ps-node');
const si = require('systeminformation');

var net = require('net');
var tcpClient = new net.Socket();

var process = require('process'); 
console.log('This process is your pid ' + process.pid);

const redis = require('redis');
const redisClient = redis.createClient();
redisClient.connect();

//Init Chess.js parser
const Engine = require('node-uci').Engine

const { Chess } = require('./node_modules/chess.js/chess.js')
var chess = new Chess()

//console.log(os.cpus());
//console.log(os.totalmem());
//console.log(os.freemem())


var  heartbeatTimer = setInterval(heartbeatToController,process.env.HEARTBEAT_TIMER);

var botInfo = {
	botHost: os.hostname(),
	botPID: process.pid,
	botStartTime: Date.now(),
	botLastHeartbeat: Date.now(),
	dataType: "botInfo",
	botCoresAvailable: os.cpus().length,
	botCoreType: os.cpus()[0].model,
	botCoreSpeed: (os.cpus()[0].speed)/1000+"Ghz",
	botHostLoad1m: os.loadavg()[0],
	botHostLoad5m: os.loadavg()[1],
	botHostLoad15m: os.loadavg()[2],
}

var gameInfo = {
	thisMove: {
		selectedMove: "none",
		moveNum: 0,
		moveStockfish: 0,
		moveMemory: 0
	},
	gameStats: {
		moveCount: 0,
		in_check: 0,
	},
	thisGame: {
		stackFen: ""
	},
	thisMoveTemp:{
		availableMoves: []
	}

}
var fullGameMovearray = []
const chessEngine = new Engine(process.env.CHESS_ENGINE)
chessEngine.init();



tcpClient.connect(process.env.BOT_CONTROLLER_PORT, process.env.BOT_CONTROLLER_HOST, function() {
	console.log('Connected');
	tcpClient.write(JSON.stringify(botInfo)+"\n", "utf-8");
});

tcpClient.on('data', function(data) {
	//console.log('Received: ' + data);
	//tcpClient.destroy(); // kill client after server's response

	var dataHash = JSON.parse(data);
	if(dataHash.function === "StartGame"){
		console.log(dataHash);
		console.log("Starting Game");
		gameInfo.thisGame = dataHash;
		runTheMove();
	}



});

tcpClient.on('close', function() {
	console.log('Connection closed');
});


var gameStatsToHost = {
		moveArray: [],
		gameStartTime: Date.now(),
		botPID: process.pid
		};

function runTheMove(){
	console.log("Run The Move")

	buildMoveDocument(gameInfo).
	then((gameInfo => checkElasticsearch(gameInfo).
	then((gameInfo => checkStockfish(gameInfo).
	then((gameInfo => makeTheMove(gameInfo).
	then((gameInfo=> checkGameStatus(gameInfo)))))))));

}

async function checkGameStatus(gameInfo){
	try{
		if(chess.game_over()){
			console.log("Game Over");
			console.log(chess.ascii())
			console.log(chess.turn());
			gameStatsToHost.moveCount = gameStatsToHost.moveArray.length;
			if(chess.in_checkmate()){
				console.log("Game in Checkmate")
				gameStatsToHost.gameEnding = "checkmate";
				if(chess.turn() === "w"){
					gameStatsToHost.winner = "b";
				}else{
					gameStatsToHost.winner = "w";
				}
			}else if(chess.in_draw()){
				console.log("Game in Draw")
				gameStatsToHost.gameEnding = "draw";
				gameStatsToHost.moveArray = [];

			}else if(chess.in_threefold_repetition){
				console.log("Game is three fold repetition");
				gameStatsToHost.gameEnding = "repetition";
				gameStatsToHost.moveArray = [];

			}else if(chess.in_stalemate()){
				console.log("Game is Stalemate");
				gameStatsToHost.gameEnding = "stalemate";
				gameStatsToHost.moveArray = [];

			}else if(chess.in_insufficient_material){
				console.log("Insifficient Material")
				gameStatsToHost.gameEnding = "insufficient_material";
				gameStatsToHost.moveArray = [];

			}
			gameStatsToHost.botHost = os.hostname();
			gameStatsToHost.function = "processGame";
			gameStatsToHost.gameEndtime = Date.now();
			gameStatsToHost.totalGametime = gameStatsToHost.gameEndtime - gameStatsToHost.gameStartTime;
			//console.log(JSON.stringify(gameStatsToHost))
			//tcpClient.write(JSON.stringify(gameStatsToHost))

			gameStatsToHost = {
				moveArray: [],
				gameStartTime: Date.now(),
				botPID: process.pid
			};
			gameInfo = {
				thisMove: {
					selectedMove: "none",
					moveNum: 0,
					moveStockfish: 0,
					moveMemory: 0
				},
				gameStats: {
					moveCount: 0,
					in_check: 0,
				},
				thisGame: {
					stackFen: ""
				},
				thisMoveTemp:{
					availableMoves: []
				}
			}
			chess.reset();
			process.exit(1)
		}else{

			//gameInfo.thisMove.fenMoveKey = gameInfo.thisMove.fenMD5+":"+gameInfo.thisMove.availableMovesMD5+":"+gameInfo.thisMove.selectedMove;
			//gameInfo.thisMove.fullMoveKey = gameInfo.thisMove.fenMD5+":"+gameInfo.thisMove.stackFenMD5+":"+gameInfo.thisMove.availableMovesMD5+":"+gameInfo.thisMove.selectedMove;
			console.log(gameInfo.thisMove.fullMoveKey)
			if(chess.in_check()){
				gameInfo.thisMove.pieceStatus = "Check";
			}else{
				gameInfo.thisMove.pieceStatus = "Free";
			}
			gameStatsToHost.moveArray.push(gameInfo.thisMove)
			console.log(gameInfo.thisMove);

			gameInfo.thisMove = {
				selectedMove: "none",
				moveNum: gameInfo.thisMove.moveNum,
				previousFen: gameInfo.thisMove.fen
			}

			await runTheMove()

		}
	}catch(error){
		console.log(error)
	}
}

async function makeTheMove(gameInfo){
	try{
		if(chess.game_over()){return gameInfo;}
		gameInfo.thisMove.moveResult = await chess.move(gameInfo.thisMove.selectedMove, {sloppy: true})
		gameInfo.thisMove.moveEndtime = Date.now();
		gameInfo.thisMove.moveTotalTime = gameInfo.thisMove.moveEndtime - gameInfo.thisMove.moveStartTime
		gameInfo.thisMove.botHost = botInfo.botHost;
		gameInfo.thisMove.botPID = botInfo.botPID;
		++gameInfo.thisMove.moveNum;
		console.log(gameInfo.thisMove)
		tcpClient.write(JSON.stringify(gameInfo.thisMove)+"\n", "utf-8")

		console.log("Send Move to Host")
		return gameInfo
	}catch(error){
		console.log(error);
	}
}

async function checkStockfish(){
	try{

		if(chess.game_over()){return gameInfo;}
		if(gameInfo.thisMove.selectedMove === "none"){
			console.log("No Move from Elasticsearch checking Stockfish");
			//console.log("Stockfish Calculating")
			await chessEngine.setoption('MultiPV', '1');
			await chessEngine.setoption('Threads', gameInfo.thisGame.STOCKFISH_THREADS);
			await chessEngine.isready();
			await chessEngine.position(chess.fen());
			const result = await chessEngine.go({depth:gameInfo.thisGame.STOCKFISH_DEPTH , nodes: gameInfo.thisGame.STOCKFISH_NODES });
			//console.log(result);
			gameInfo.thisMove.selectedMove = result.bestmove;
		}
		if(gameInfo.thisMove.selectedMove !== "none"){
			gameInfo.thisMove.engineUsed = "stockfish";
			gameInfo.thisMove.moveStockfish=  1;
		}

		return gameInfo;
	}catch(error){
		console.log(error)
	}
}

async function checkElasticsearch(gameInfo){
	try{		if(chess.game_over()){return gameInfo;}

		console.log("Check Elasticsearch");

		return gameInfo;
	}catch(error){

	}

}

async function buildMoveDocument(gameInfo){
	try{
		if(chess.game_over()){return gameInfo;}

		clearInterval(gameInfo.moveTimer);
		if(gameInfo.thisMove.fen){
			gameInfo.previousFen = gameInfo.thisMove.fen
		}
		gameInfo.thisMove.turn = chess.turn();
		gameInfo.thisMoveTemp.fenArray = chess.fen().split(" - ");
		gameInfo.thisMove.fen = gameInfo.thisMoveTemp.fenArray[0];
		gameInfo.thisMove.fenMD5 = md5(gameInfo.thisMove.fen[0]);
		gameInfo.thisGame.stackFen += gameInfo.thisMove.fen[0];
		gameInfo.thisMove.stackFenMD5 = md5(gameInfo.thisGame.stackFen);
		gameInfo.thisMoveTemp.availableMoves = chess.moves({verbose: true});
		gameInfo.thisMove.availableMovesMD5 = md5(chess.moves({verbose: true}));
		gameInfo.thisMove.moveStartTime = Date.now();
		gameInfo.thisMove.selectedMove = "none";
		gameInfo.thisMove.engineUsed = "none";

		return gameInfo;
	}catch(error){
		console.log(error)
	}
}


function heartbeatToController(){
	//console.log('Heartbeat');
	botInfo.dataType = "heartbeat"
	botInfo.botHostLoad1m = os.loadavg()[0];
	botInfo.botHostLoad5m = os.loadavg()[1];
	botInfo.botHostLoad15m = os.loadavg()[2];
	botInfo.botLastHeartbeat = Date.now();
	tcpClient.write(JSON.stringify(botInfo), "utf-8");
}