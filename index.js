//////////////////////////////////////////////////////////////////////
//	Copyright (C) Hiroshi SUGIMURA 2020.09.19
//////////////////////////////////////////////////////////////////////
'use strict'

const tradfriLib = require("node-tradfri-client");
const TradfriClient = tradfriLib.TradfriClient;
const discoverGateway = tradfriLib.discoverGateway;


//////////////////////////////////////////////////////////////////////
// Tradfri，複数のTradfri gwを管理する能力はない
// クラス変数
let Tradfri = {
	// member
	// user config
  securityCode: '', // GWの裏面，初回だけ必要
  identity: '',
  psk: '',
  userFunc: {},  // callback function

	// private
  gw: {},
  gwAddress: '',
  client: {},
  autoGet: true, // true = 自動的にGetをする
  autoGetInterval: 1000, // 自動取得のときに，すぐにGetせずにDelayする
  autoGetWaitings: 0, // 自動取得待ちの個数
  debugMode: false,
  autoGetTimerEnabled: false,
  autoGetTimerID: null,  // ID管理，Timeoutクラス

	// public
  facilities: {},	// 全機器情報リスト
};


////////////////////////////////////////
// inner functions

// 時間つぶす関数
Tradfri.sleep = async function (ms) {
	return new Promise(function(resolve) {
		setTimeout(function() {resolve()}, ms);
	})
}


// キーでソートしてからJSONにする
// 単純にJSONで比較するとオブジェクトの格納順序の違いだけで比較結果がイコールにならない
Tradfri.objectSort = function (obj) {
	// まずキーのみをソートする
	let keys = Object.keys(obj).sort();

	// 返却する空のオブジェクトを作る
	let map = {};

	// ソート済みのキー順に返却用のオブジェクトに値を格納する
	keys.forEach(function(key){
		map[key] = obj[key];
	});

	return map;
};

//////////////////////////////////////////////////////////////////////
// Tradfri特有の手続き
//////////////////////////////////////////////////////////////////////

// 何もしない関数, userFunc is undef.
Tradfri.dummy = function() {
};


function tradfri_deviceUpdated(device) {
	if( Tradfri.debugMode == true ) {
		console.log('tradfri_deviceUpdated');
	}

	Tradfri.facilities = Tradfri.client.devices;  // 機器情報更新

	if( Tradfri.userFunc ) {
		Tradfri.userFunc( Tradfri.gwAddress, device, null); // アップデートのあったデバイス情報だけ
	}
}

function tradfri_deviceRemoved(instanceId) {
	// clean up
	if( Tradfri.debugMode == true ) {
		console.log('tradfri_deviceRemoved', instanceId);
	}
}

function tradfri_observeNotifications() {
	console.log('observeNotifications');
}


//////////////////////////////////////////////////////////////////////
// 初期化
Tradfri.initialize = async function ( securityCode, userFunc, Options = { identity: '', psk: '', autoGet: true, autoGetInterval: 60000, debugMode: false}) {

	Tradfri.gw = {};
	Tradfri.facilities = {};
	Tradfri.securityCode      = securityCode      == undefined ? ''            : securityCode;
	Tradfri.userFunc          = userFunc          == undefined ? Tradfri.dummy : userFunc;
	Tradfri.debugMode         = Options.debugMode == undefined || Options.debugMode == false ? false : true;   // true: show debug log
	Tradfri.autoGet           = Options.autoGet         != false     ? true                    : false;	// 自動的なデータ送信の有無
	Tradfri.autoGetInterval   = Options.autoGetInterval != undefined ? Options.autoGetInterval : 60000;	// 自動GetのDelay, default 1min
	Tradfri.identity          = Options.identity    == undefined || Options.identity    === '' ? '' : Options.identity;
	Tradfri.psk               = Options.psk         == undefined || Options.psk         === '' ? '' : Options.psk;

	Tradfri.autoGetTimerEnabled = false; // autoGetが動いているか？
	Tradfri.autoGetTimerID = null;  // ID管理，Timeoutクラス

	if( Tradfri.debugMode == true ) {
		console.log('==== tradfri-handler.js ====');
		console.log('securityCode:', Tradfri.securityCode, 'identity:', Tradfri.identity, 'psk:', Tradfri.psk );
		console.log('autoGet:', Tradfri.autoGet, ', autoGetInterval: ', Tradfri.autoGetInterval );
		console.log('debugMode:', Tradfri.debugMode );
	}

	while( !Object.keys(Tradfri.gw).length ) {  // {}でチェックできない
		try{
			// find GW
			Tradfri.gw = await discoverGateway();
			if( Tradfri.gw == {} ) {
				// 失敗したら30秒まつ
				Tradfri.sleep( 30000 );
			}
		}catch (e) {
			console.error(e);
			throw e;
		}
	}

	Tradfri.gwAddress = Tradfri.gw.addresses[0];  // 一つしか管理しない

	if( Tradfri.debugMode == true ) {
		console.log( 'Found Tradfri.gw' );
		console.dir( Tradfri.gw );
		console.log('connect:', Tradfri.gwAddress);
	}

	Tradfri.client = new TradfriClient( Tradfri.gwAddress );

	if( Tradfri.identity === '' ) { // 新規Link
		console.log('authenticate');
		try{
			const ret = await Tradfri.client.authenticate( Tradfri.securityCode );
			Tradfri.identity = ret.identity;
			Tradfri.psk = ret.psk;
			console.dir( Tradfri.identity );
			console.dir( Tradfri.psk );
		} catch(e) {
			console.error('E: authenticate');
			console.dir(e);
			throw e;
		}
	}

	Tradfri.client.on("device updated", tradfri_deviceUpdated);
	Tradfri.client.on("device removed", tradfri_deviceRemoved);

	if( Tradfri.autoGet == true ) {
		Tradfri.autoGetStart( Tradfri.autoGetInterval );
	}
	Tradfri.getState();

	return {identity: Tradfri.identity, psk: Tradfri.psk};
};

// request(options, function (error, response, body) { })
Tradfri.getState = function() {
	// 状態取得
	Tradfri.client.connect(Tradfri.identity, Tradfri.psk);
	Tradfri.client.observeDevices();
};


Tradfri.setState = function( stateJson ) {
};


//////////////////////////////////////////////////////////////////////
// 定期的なデバイスの監視

// 実際に監視する関数
Tradfri.autoGetInner = function( interval ) {
	Tradfri.getState( );

	// 処理をしたので次のタイマーをセット
	if( Tradfri.autoGetTimerEnabled == true ) {  // 次もやるかチェックしておく
		Tradfri.autoGetTimerSet( interval );
	}
};

// タイマーで動く関数をセット
Tradfri.autoGetTimerSet = function( interval ) {
	Tradfri.autoGetTimerID = setTimeout( Tradfri.autoGetInner, interval, interval );
};


// インタフェース，監視を始める
Tradfri.autoGetStart = function ( interval ) {
	// configファイルにobservationDevsが設定されていれば実施
	if( Tradfri.debugMode ) {
		console.log( 'Tradfri.autoGet is started.', interval, 'ms' );
	}
	if( Tradfri.autoGetTimerEnabled == true ) { // すでに開始していたら何もしない
		return;
	}
	Tradfri.autoGetTimerEnabled = true;

	if( Tradfri.gwAddress ) { // IPがすでにないと例外になるので
		Tradfri.autoGetTimerSet( interval );
	}
};

// インタフェース，監視をやめる
Tradfri.autoGetStop = function() {
	if( Tradfri.debugMode ) {
		console.log( 'Tradfri.autoGet is stoped.' );
	}

	Tradfri.autoGetTimerEnabled = false;

	if( Tradfri.autoGetTimerID ) { // 現在登録されているタイマーを消す
		clearTimeout ( Tradfri.autoGetTimerID );
	}
};


//////////////////////////////////////////////////////////////////////
// facilitiesの定期的な監視
// ネットワーク内のEL機器全体情報を更新したらユーザの関数を呼び出す
// facilitiesにて変更あれば呼び出される
Tradfri.setObserveFacilities = function ( interval, onChanged ) {
	let oldVal = JSON.stringify( Tradfri.objectSort(Tradfri.facilities) );
	const onObserve = function() {
		const newVal = JSON.stringify(Tradfri.objectSort(Tradfri.facilities));
		if ( oldVal == newVal ) return;
		onChanged();
		oldVal = newVal;
	};

	setInterval( onObserve, interval );
};


module.exports = Tradfri;

//////////////////////////////////////////////////////////////////////
// EOF
//////////////////////////////////////////////////////////////////////
