# Overview

tradfri-handler

# Install

下記コマンドでモジュールをインストールできます．

You can install the module as following command.


```bash
npm i tradfri-handler
```

もしかしたら下記が必要かもしれません。

```bash
npm i node-cron
```



# Demo, example

```
'use strict'

const cron = require('node-cron');
const TF = require('tradfri-handler');

////////////////////////////////////////
// config
const TFkey      = '';      // GWの裏面に書いてある，初回だけ必要
let   TFidentity = ''; // GW自動生成を記録しておいて、2回目以降は設定しておくと接続早くなる
let   TFpsk      = ''; // GW自動生成を記録しておいて、2回目以降は設定しておくと接続早くなる


let dev = {};

// 受信後の処理
let TFReceived = function(rIP, device, error) {
	if( error ) {
		console.log('-- received error');
		console.error( error );
		return;
	}

	// if( device.lightList ) {
	if( device.type === TF.AccessoryTypes.lightbulb ) {
		// console.log( device );

		if( device.instanceId == 65539 ) {  // 上のlogを有効にして、ライトのIDを探して設定する
			dev = device;
		}
	}

	// console.log('-- received, IP:', rIP, ', device:', device);
};


// Tradfri.initialize
async function TFStart() {
	try{
		let co = await TF.initialize( TFkey, TFReceived, {identity: TFidentity, psk: TFpsk, debugMode:true} );

		// 2回目以降はidentityとpskを設定しておくと接続が早い
		console.log('TF connected, identity=', co.identity, ', psk=', co.psk);
	}catch(e){
		console.dir(e);
	}


	// facilitiesの定期的監視
	let oldVal = JSON.stringify( TF.objectSort(TF.facilities) );
	let c1 = cron.schedule('0 */1 * * * *', () => {  // 1分毎にautoget、変化があればログ表示
		const newVal = JSON.stringify( TF.objectSort(TF.facilities) );
		if ( oldVal == newVal ) return; // 変化した
		oldVal = newVal;
		console.log('TF changed, new TF.facilities:', newVal);
	});
	c1.start();


	// 点滅
	let on_off = 'on';
	let c2 = cron.schedule('*/10 * * * * *', async () => {
		try{
			if( on_off == 'on' ) {
				await dev.lightList[0].turnOff();
				on_off = 'off';
			}else{
				await dev.lightList[0].turnOn();
				on_off = 'on';
			}
			console.log('on_off:', on_off);
		}catch( error ) {
			console.error( error );
		}
	});
	c2.start();

};

TFStart();  // 実行
```


# Data stracture



# API

## 初期化と受信, 監視, initialize, receriver callback and observation


- TF.initialize( TFkey, TFReceived, {identity: TFidentity, psk: TFpsk, debugMode:false} )
	- TFReceived(rIP, devices, error)
- TF.setObserveFacilities( interval, function )


## Authors

神奈川工科大学  創造工学部  ホームエレクトロニクス開発学科; Dept. of Home Electronics, Faculty of Creative Engineering, Kanagawa Institute of Technology

杉村　博; SUGIMURA, Hiroshi


## License

This library is MIT License

```
-- License summary --
o Commercial use
o Modification
o Distribution
o Private use
x Liability
x Warranty
```

### Dependencies

- MIT
	- node-tradfri-client; https://www.npmjs.com/package/node-tradfri-client


## Log

- 0.5.0 安定性向上、少しコントロールもできるように
- 0.0.1 start up
