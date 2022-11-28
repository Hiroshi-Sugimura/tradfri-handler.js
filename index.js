//////////////////////////////////////////////////////////////////////
//	Copyright (C) Hiroshi SUGIMURA 2020.09.19
//////////////////////////////////////////////////////////////////////
'use strict'

const tradfriLib = require("node-tradfri-client");
const TradfriClient   = tradfriLib.TradfriClient;
const discoverGateway = tradfriLib.discoverGateway;
const AccessoryTypes  = tradfriLib.AccessoryTypes;
const cron            = require('node-cron');


//////////////////////////////////////////////////////////////////////
// Tradfri，複数のTradfri gwを管理する能力はない
// クラス変数
let Tradfri = {
	AccessoryTypes: AccessoryTypes,
	// member
	// user config
	securityCode: '', // GWの裏面，初回だけ必要
	identity: '',
	psk: '',
	userFunc: {},  // callback function

	// private
	enabled: false, // 多重起動防止
	gw: {},
	gwAddress: '',
	client: {},
	autoGet: true, // true = 自動的に状態取得をする
	debugMode: false,
	autoGetCron: null,  // 状態の自動取得
	canceled: false,  // 初期化のキャンセル管理

	// public
	facilities: {},	// 全機器情報リスト

	////////////////////////////////////////
	// inner functions

	// 時間つぶす関数
	sleep: async function (ms) {
		return new Promise(function(resolve) {
			setTimeout(function() {resolve()}, ms);
		})
	},


	// キーでソートしてからJSONにする
	// 単純にJSONで比較するとオブジェクトの格納順序の違いだけで比較結果がイコールにならない
	objectSort: function (obj) {
		// まずキーのみをソートする
		let keys = Object.keys(obj).sort();

		// 返却する空のオブジェクトを作る
		let map = {};

		// ソート済みのキー順に返却用のオブジェクトに値を格納する
		keys.forEach(function(key){
			map[key] = obj[key];
		});

		return map;
	},

	// Object型が空{}かどうかチェックする。 obj == {} ではチェックできない事に注意
	isObjEmpty: function (obj) {
		return Object.keys(obj).length === 0;
	},


	//////////////////////////////////////////////////////////////////////
	// Tradfri特有の手続き
	//////////////////////////////////////////////////////////////////////
	// 何もしない関数, when userFunc is undef, receiving data is forwarded to dummy.
	dummy: function( addr, dev, err) {
		Tradfri.debugMode? console.log('Tradfri.dummy( addr:', addr, ', dev:', dev, 'err:', err, ')' ):0;
	},

	_deviceUpdated: function (device) {
		// Tradfri.debugMode? console.log('_deviceUpdated, device:', device): 0;

		Tradfri.facilities = Tradfri.client.devices;  // 機器情報更新

		if( Tradfri.userFunc ) {
			Tradfri.userFunc( Tradfri.gwAddress, device, null); // アップデートのあったデバイス情報だけ
		}
	},

	_deviceRemoved: function (instanceId) { // clean up
		Tradfri.debugMode? console.log('_deviceRemoved', instanceId):0;
	},

	_observeNotifications: function () {
		Tradfri.debugMode? console.log('observeNotifications'):0;
	},


	//////////////////////////////////////////////////////////////////////
	// 初期化
	initialize: async function ( securityCode, userFunc, Options = { identity: '', psk: '', autoGet: true, debugMode: false}) {
		// 多重起動防止
		if( Tradfri.enabled ) return;
		Tradfri.enabled = true;

		Tradfri.canceled = false; // 初期化キャンセル管理

		Tradfri.gw = {};
		Tradfri.facilities = {};
		Tradfri.securityCode      = securityCode      == undefined ? ''            : securityCode;
		Tradfri.userFunc          = userFunc          == undefined ? Tradfri.dummy : userFunc;
		Tradfri.debugMode         = Options.debugMode == undefined || Options.debugMode == false ? false : true;   // true: show debug log
		Tradfri.autoGet           = Options.autoGet     != false     ? true                    : false;	// 自動的な状態取得の有無
		Tradfri.identity          = Options.identity    == undefined || Options.identity    === '' ? '' : Options.identity;
		Tradfri.psk               = Options.psk         == undefined || Options.psk         === '' ? '' : Options.psk;

		if( Tradfri.debugMode == true ) {
			console.log('==== tradfri-handler.js ====');
			console.log('securityCode:', Tradfri.securityCode, 'identity:', Tradfri.identity, 'psk:', Tradfri.psk );
			console.log('autoGet:', Tradfri.autoGet );
		}

		while( !Object.keys(Tradfri.gw).length ) {  // {}でチェックできない
			if( Tradfri.canceled ) {  // 初期化中にキャンセルがきた
				Tradfri.userFunc( null, 'Canceled', null );
				Tradfri.enabled = false;
				return null;
			}

			try{
				// find GW
				Tradfri.gw = await discoverGateway();
				if( Tradfri.isObjEmpty(Tradfri.gw) ) {
					// 失敗したら30秒まつ
					await Tradfri.sleep( 30000 );
				}
			}catch (e) {
				console.error(e);
				console.dir(e);
				Tradfri.enabled = false;
				throw e;
			}
		}

		Tradfri.gwAddress = Tradfri.gw.addresses[0];  // 一つしか管理しない

		Tradfri.debugMode? console.log( 'Tradfri.initialize() address:', Tradfri.gwAddress, ', gw', Tradfri.gw ):0;

		Tradfri.client = new TradfriClient( Tradfri.gwAddress );

		if( Tradfri.identity === '' ) { // 新規Link
			console.log('authenticate');
			try{
				const ret = await Tradfri.client.authenticate( Tradfri.securityCode );
				Tradfri.identity = ret.identity;
				Tradfri.psk = ret.psk;
				Tradfri.debugMode? console.dir( Tradfri.identity ):0;
				Tradfri.debugMode? console.dir( Tradfri.psk ):0;
			} catch(e) {
				console.error('E: authenticate');
				console.dir(e);
				Tradfri.enabled = false;
				throw e;
			}
		}

		Tradfri.client.on("device updated", Tradfri._deviceUpdated);
		Tradfri.client.on("device removed", Tradfri._deviceRemoved);

		if( Tradfri.canceled ) {  // 初期化中にキャンセルがきた
			Tradfri.userFunc( null, 'Canceled', null );
			Tradfri.enabled = false;
			return null;
		}

		if( Tradfri.autoGet == true ) {
			Tradfri.autoGetStart();
		}
		Tradfri.getState();

		return {identity: Tradfri.identity, psk: Tradfri.psk};
	},

	//====================================================================
	// 初期化キャンセル
	initializeCancel: function() {
		Tradfri.canceled = true;
	},

	//====================================================================
	// 解放
	release: async function() {
		if( !Tradfri.enabled )  return; // 多重開放の防止
		Tradfri.enabled = false;
		await Tradfri.autoGetStop();
		await Tradfri.client.destroy();
	},


	//////////////////////////////////////////////////////////////////////
	// request(options, function (error, response, body) { })
	getState: function() {
		// 状態取得
		Tradfri.client.connect(Tradfri.identity, Tradfri.psk);
		Tradfri.client.observeDevices();
	},


	setState: async function( devId, stateJson ) {
		// const response = await Tradfri.client.request( devId, "post", stateJson );
		// Tradfri.client.operateLight( dev, )
		// Tradfri.debugMode? console.log( 'Tradfri.setState() response:', response ):0;
	},


	//////////////////////////////////////////////////////////////////////
	// 定期的なデバイスの監視
	// インタフェース，監視を始める
	autoGetStart: function ( interval ) {
		// configファイルにobservationDevsが設定されていれば実施
		Tradfri.debugMode? console.log( 'Tradfri.autoGetStart()' ):0;

		if( Tradfri.autoGetCron != null ) { // すでに開始していたら何もしない
			return;
		}

		if( Tradfri.gwAddress ) { // IPがすでにないと例外になるので
			Tradfri.autoGetCron = cron.schedule('*/1 * * * *', async () => {  // 1分毎にautoget
				Tradfri.getState();
			});

			Tradfri.autoGetCron.start();
		}
	},

	// インタフェース，監視をやめる
	autoGetStop: function() {
		Tradfri.debugMode? console.log( 'Tradfri.autoGetStop()' ) : 0;

		if( Tradfri.autoGetCron ) { // 現在登録されているタイマーを消す
			Tradfri.autoGetCron.stop();
		}
		Tradfri.autoGetCron = null;
	}
};


module.exports = Tradfri;

//////////////////////////////////////////////////////////////////////
// EOF
//////////////////////////////////////////////////////////////////////
