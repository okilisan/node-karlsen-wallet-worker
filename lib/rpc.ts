import {IRPC, RPC as Rpc, SubscriberItem, SubscriberItemMap} from '../types/custom-types';
import {WorkerCore} from './core';
type CBItem = {uid?:string, cb:Function};
const UID = ()=>(Math.random()*100000).toFixed(0)+Date.now();

export {IRPC};

export class Client{
	callbacks:Map<string, CBItem[]> = new Map();
	subscribers:SubscriberItemMap = new Map();
	pending:Map<string, {method:string, cb:Function}> = new Map();

	verbose:boolean = false;
	log:Function;
	core:WorkerCore;

	constructor(core:WorkerCore, options:any={}){
		this.core = core;
		this.log = Function.prototype.bind.call(
			console.log,
			console,
			`[Kaspa gRPCProxy]:`
		);

		//const directFns = [
		//	'onConnect', 'onDisconnect', 'onConnectFailure', 'onError'
		//]

		//seperate callback for direct function
		this.core.on('rpc-direct', (msg:{rid:string, result:any})=>{
			const {rid, result} = msg;
			let items:CBItem[]|undefined = this.callbacks.get(rid);
			if(!items)
				return
			items.map(item=>item.cb(result));
		})

		this.core.on('rpc-result', (msg:{rid:string, result:any, error:any})=>{
			const {rid, result, error} = msg;
			let pending:{method:string, cb:Function}|undefined = this.pending.get(rid);
			if(!pending)
				return
			pending.cb(error, result);
			
			//if(!directFns.includes(pending.method)){
				this.pending.delete(rid);
			//}
		})

		this.core.on('rpc-pub', (msg:{result:any, method:string})=>{
			const {result, method} = msg;
			let eventName = this.subject2EventName(method);
			this.verbose && this.log("subscribe:eventName", eventName)

			let subscribers:SubscriberItem[]|undefined = this.subscribers.get(eventName);
			if(!subscribers || !subscribers.length)
				return

			subscribers.map(subscriber=>{
				subscriber.callback(result)
			})
		})
	}

	addCB(key:string, cb:Function){
		let uid = UID();
		let list:CBItem[]|undefined = this.callbacks.get(key);

		if(!list){
			list = [];
			this.callbacks.set(key, list);
		}
		list.push({uid, cb});
		return uid;
	}

	req(fn:string, args:any[], rid:string=''){
		this.core.postMessage("rpc", {fn, args, rid})
	}

	call(method:string, data:any={}){
		return new Promise((resolve, reject)=>{
			let rid = UID();
			this.pending.set(rid, {
				method,
				cb:(error:any, result:any=undefined)=>{
					if(error)
						return reject(error);
					resolve(result);
				}
			})
			this.req('call', [method, data], rid);
		})
	}

	onConnect(callback:Function){
		let rid = this.addCB("onConnect", callback);
		this.req("onConnect", [{}], rid);
	}
	onDisconnect(callback:Function){
		let rid = this.addCB("onDisconnect", callback);
		this.req("onDisconnect", [{}], rid);
	}
	onConnectFailure(callback:Function){
		let rid = this.addCB("onConnectFailure", callback);
		this.req("onConnectFailure", [{}], rid);
	}
	onError(callback:Function){
		let rid = this.addCB("onError", callback);
		this.req("onError", [{}], rid);
	}

	disconnect(){
		this.req("disconnect", [{}]);
	}

	subscribe<T>(subject: string, data: any, callback: Function): Rpc.SubPromise<T>{
		let eventName = this.subject2EventName(subject);
		this.verbose && this.log("subscribe:eventName", eventName)

		let subscribers:SubscriberItem[]|undefined = this.subscribers.get(eventName);
		if(!subscribers){
			subscribers = [];
			this.subscribers.set(eventName, subscribers);
		}
		let uid = UID();
		subscribers.push({uid, callback});

		let p = this.call(subject, data) as Rpc.SubPromise<T>;

		p.uid = uid;
		return p;
	}

	subject2EventName(subject:string){
		let eventName = subject.replace("notify", "").replace("Request", "Notification")
		return eventName[0].toLowerCase()+eventName.substr(1);
	}

	unSubscribe(subject:string, uid:string=''){
		let eventName = this.subject2EventName(subject);
		let subscribers:SubscriberItem[]|undefined = this.subscribers.get(eventName);
		if(!subscribers)
			return
		if(!uid){
			this.subscribers.delete(eventName);
		}else{
			subscribers = subscribers.filter(sub=>sub.uid!=uid)
			this.subscribers.set(eventName, subscribers);
		}
	}

}

export class RPC implements IRPC{
	client:Client;
	constructor(options:any={}){
		this.client = options.client;
	}
	onConnect(callback:Function){
		this.client.onConnect(callback);
	}
	onConnectFailure(callback:Function){
		this.client.onConnectFailure(callback);
	}
	onError(callback:Function){
		this.client.onError(callback);
	}
	onDisconnect(callback:Function){
		this.client.onDisconnect(callback);
	}
	disconnect(){
		this.client?.disconnect();
	}
	unSubscribe(method:string, uid:string=''){
		return this.client.unSubscribe(method, uid);
	}
	subscribe<T, R>(method:string, data:any, callback:Rpc.callback<R>){
		return this.client.subscribe<T>(method, data, callback);
	}
	request<T>(method:string, data:any){
		return this.client.call(method, data) as Promise<T>;
	}

	subscribeChainChanged(callback:Rpc.callback<Rpc.ChainChangedNotification>){
		return this.subscribe<Rpc.NotifyChainChangedResponse, Rpc.ChainChangedNotification>("notifyChainChangedRequest", {}, callback);
	}
	subscribeBlockAdded(callback:Rpc.callback<Rpc.BlockAddedNotification>){
		return this.subscribe<Rpc.NotifyBlockAddedResponse, Rpc.BlockAddedNotification>("notifyBlockAddedRequest", {}, callback);
	}
	subscribeVirtualSelectedParentBlueScoreChanged(callback:Rpc.callback<Rpc.VirtualSelectedParentBlueScoreChangedNotification>){
		return this.subscribe<Rpc.NotifyVirtualSelectedParentBlueScoreChangedResponse, Rpc.VirtualSelectedParentBlueScoreChangedNotification>("notifyVirtualSelectedParentBlueScoreChangedRequest", {}, callback);
	}

	subscribeUtxosChanged(addresses:string[], callback:Rpc.callback<Rpc.UtxosChangedNotification>){
		return this.subscribe<Rpc.NotifyUtxosChangedResponse, Rpc.UtxosChangedNotification>("notifyUtxosChangedRequest", {addresses}, callback);
	}

	unSubscribeUtxosChanged(uid:string=''){
		this.unSubscribe("notifyUtxosChangedRequest", uid);
	}

	getBlock(hash:string){
		return this.request<Rpc.BlockResponse>('getBlockRequest', {hash, includeBlockVerboseData:true});
	}
	getTransactionsByAddresses(startingBlockHash:string, addresses:string[]){
		return this.request<Rpc.TransactionsByAddressesResponse>('getTransactionsByAddressesRequest', {
			startingBlockHash, addresses
		});
	}
	getUtxosByAddresses(addresses:string[]){
		return this.request<Rpc.UTXOsByAddressesResponse>('getUtxosByAddressesRequest', {addresses});
	}
	submitTransaction(tx: Rpc.SubmitTransactionRequest){
		return this.request<Rpc.SubmitTransactionResponse>('submitTransactionRequest', tx);
	}

	getVirtualSelectedParentBlueScore(){
		return this.request<Rpc.VirtualSelectedParentBlueScoreResponse>('getVirtualSelectedParentBlueScoreRequest', {});
	}
}