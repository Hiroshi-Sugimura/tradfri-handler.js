# Overview

tradfri-handler

# Install

下記コマンドでモジュールをインストールできます．

You can install the module as following command.


```bash
npm i tradfri-handler
```


# Demo, example

```
const TF = require('tradfri-handler');

////////////////////////////////////////
// test config
const TFkey = ''; // GWの裏面に書いてある，初回だけ必要
let TFidentity = '_1600341268392'; // GW自動生成を記録しておく
let TFpsk = '';// GW自動生成を記録しておく


// Hue受信後の処理
let TFReceived = function(rIP, devices, error) {
	console.log('-- received');

	if( error ) {
		console.error( error );
		return;
	}

	// console.dir( devices );
};


// Tradfri.initialize
try{
	TF.initialize( TFkey, TFReceived, {identity: TFidentity, psk: TFpsk, debugMode:false} );
}catch(e){
	console.dir(e);
}

// Hue.facilitiesの定期的監視
TF.setObserveFacilities( 10000, () => {
	console.dir( TF.facilities );
});

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

- 0.0.1 start up
