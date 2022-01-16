import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import multicallABI from './abi/multicall.json';
import { MulticallData } from './multicall.model';

import * as fs from 'fs';

@Injectable()
export class MulticallService {
  private readonly logger = new Logger(MulticallService.name);

  private multicallFullIface: string | string[];
  private multicallAddress: string;
  private multicallContract: ethers.Contract;

  private rpcProvider: string;

  constructor(private configService: ConfigService) {
    const iface = new ethers.utils.Interface(multicallABI);
    const FormatTypes = ethers.utils.FormatTypes;

    this.rpcProvider = this.configService.get<string>('RPC_ENDPOINT');

    this.multicallFullIface = iface.format(FormatTypes.full);
    this.multicallAddress = this.configService.get<string>('MULTICALL_ADDRESS');
    this.multicallContract = this.getMulticallContract(
      this.multicallAddress,
      multicallABI,
    );
  }

  // Make aggregate call to multicall contract
  public async aggegrateCall(callData: MulticallData[]) {
    try {
      this.logger.log(`Aggegrate call with data length: ${callData.length}`);
      const encodedData = callData.map((data) => {
        const iface = new ethers.utils.Interface([data.abi]);
        return [data.address, iface.encodeFunctionData(data.name, data.params)];
      });

      const { returnData } = await this.multicallContract.aggregate(
        encodedData,
      );

      const decodedData = callData.map((_callData, index) => {
        const iface = new ethers.utils.Interface([_callData.abi]);
        const _returnData = returnData[index];
        return iface.decodeFunctionResult(_callData.name, _returnData);
      });

      return decodedData;
    } catch (err) {
      this.logger.error(err);
      fs.writeFileSync('Err.err', (err as unknown as Error).toString());
      return [];
    }
  }

  // Return merged data of multiple aggregate call
  public async partialAggregateCall(callData: MulticallData[]) {
    const chunkSize = 2000;
    const mergedCall = [];
    let mergedData = [];
    for (let i = 0; i < callData.length; i += chunkSize) {
      const callChunk = callData.slice(i, i + chunkSize);
      mergedCall.push(this.aggegrateCall(callChunk));
    }

    const returnData = await Promise.all(mergedCall);
    returnData.map((data) => {
      mergedData = mergedData.concat(data);
    });

    return mergedData;
  }

  // Return multicall contract instance
  private getMulticallContract(address: string, abi: Array<object | string>) {
    const provider = new ethers.providers.JsonRpcProvider(this.rpcProvider);
    return new ethers.Contract(address, abi, provider);
  }
}
