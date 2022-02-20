import { Socket } from "net";
import { TLSSocket } from "tls";

export type CallbackFunction<T = any> = (
  err?: NodeJS.ErrnoException | null,
  result?: T
) => void;
export type NetStream = Socket | TLSSocket;

export type CommandParameter = string | Buffer | number | any[];
export interface ICommand {
  name: string;
  args: CommandParameter[];
  resolve(result: any): void;
  reject(error: Error): void;
}

export interface PipelineWriteableStream {
  isPipeline: true;
  write(data: string | Buffer): unknown;
  destination: { redis: { stream: NetStream } };
}

export type WriteableStream = NetStream | PipelineWriteableStream;

export interface CommandItem {
  command: ICommand;
  stream: WriteableStream;
  select: number;
}
