import {Wallet as WalletImpl, initKaspaFramework, log} from 'kaspa-wallet';
import {RPC, Client, IRPC} from './rpc';
import {EventEmitter} from './event-emitter';

class Wallet extends WalletImpl{
	emit(name:string, data:any={}){
		super.emit(name, data);
		//@ts-ignore
		postMessage({op:"wallet-events", data:{name, data}});
	}
}


export class WorkerCore extends EventEmitter{
	rpc:IRPC;
	wallet:Wallet|undefined;

	constructor(){
		super();

		this.rpc = new RPC({
			client: new Client(this)
		})
	}
	async init(){
		super.init();
		await initKaspaFramework();

		this.postMessage("ready");

		this.initWalletHanler();
		addEventListener("message", (event)=>{
			let {data:msg} = event;
			let {op, data} = msg;
			log.info(`worker got: ${op}, ${JSON.stringify(data)}`)
			if(!op)
				return
			this.emit(op, data);
		})
	}
	initWalletHanler(){
		this.on('wallet-init', (msg)=>{
			const {
				privKey,
				seedPhrase,
				networkOptions,
				options
			} = msg;
			networkOptions.rpc = this.rpc;

			this.wallet = new Wallet(privKey, seedPhrase, networkOptions, options);
			//log.info("core.wallet", this.wallet)

		})

		this.on("wallet-request", async (msg:{fn:string, rid:string, args:any[]})=>{
			let {fn, rid, args} = msg;
			let {wallet} = this;
			if(!wallet)
				return this.sendWalletResponse(rid, "Wallet not initilized yet.");
			if(!fn)
				return this.sendWalletResponse(rid, "Invalid wallet request.");

			let func;
			//@ts-ignore
			if(typeof this[fn] == 'function'){
				//@ts-ignore
				func = this[fn].bind(this);
			//@ts-ignore
			}else if(typeof wallet[fn] == 'function'){
				//@ts-ignore
				func = wallet[fn].bind(wallet);
			//@ts-ignore
			}else if(typeof wallet[fn] != undefined){
				func = async ()=>{
					//@ts-ignore
					return wallet[fn];
				}
			}

			log.debug(`wallet-request: ${fn} => ${func}`)

			if(!func){
				this.sendWalletResponse(rid, 
					"Invalid wallet request. No such wallet method available."
				);
				return
			}

			let error, result = func(...args);

			if(result instanceof Promise){
				result = await result
				.catch((err:any)=>{
					error = err;
				})
			}

			//@ts-ignore
			let errorMsg = error?.message||error;

			log.info(
				`Sending Wallet Response: \n`+
				`  FN: ${fn} \n`+
				`  error: ${errorMsg} \n`+
				`  result: ${JSON.stringify(result)} \n`
			)
			this.sendWalletResponse(rid, error, result);
		})
	}

	sendWalletResponse(rid:string, error:any=undefined, result:any=undefined){
		this.postMessage("wallet-responce", {rid, error, result});
	}
}
