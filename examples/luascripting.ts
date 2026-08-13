import {randomUUID} from "crypto";

//This is how you achieve  atomicity with luascript  when a sequence of commands is needed

export class RedisLock{
constructor(private: redis:any){}

	async acquire(key:string , ttl:5000):Promise<string | null>{
		//Gives each key a random identifier
		const value =  randomUUID()

		const result = await this.redis.set(key,value, "PX",ttl,"NX");

		if (result !== "OK") return null;

		return value

	}
//If an identical key already exists it'll be deleted
async release(key:string,value:string):Promise<void>{
	//A simple way to use  luascript
	const luascript = `if redis.call("GET",KEYS[1]) === ARV[1] then 
	return redis.call("DEL",KEYS[1])
	else
	return 0
	end
	`;

	await this.redis.eval(key, 1 ,value , luascript);

}
}
