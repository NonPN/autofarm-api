import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { MulticallData } from 'src/multicall/multicall.model';
import { MulticallService } from 'src/multicall/multicall.service';
import erc20Abi from './abi/ERC20.json';
import pairAbi from './abi/Pair.json';
import { TokenDetail } from './token.model';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private rpcProvider: ethers.providers.JsonRpcProvider;
  private cacheTokenDetail: Map<string, TokenDetail>;
  private cachePairDetail: Map<string, Array<string>>;

  constructor(
    private configService: ConfigService,
    private multicallService: MulticallService,
  ) {
    const rpcEndpoint = this.configService.get<string>('RPC_ENDPOINT');
    this.rpcProvider = new ethers.providers.JsonRpcProvider(rpcEndpoint);

    this.cacheTokenDetail = new Map<string, TokenDetail>();
    this.cachePairDetail = new Map<string, Array<string>>();
  }

  // Return token info of addresses
  async getTokenInfoBatch(addresses: string[]) {
    try {
      const callInfo = [];
      let callData: MulticallData[] = [];
      const tokenDetails: TokenDetail[] = [];

      // Add cache token info to result array or add new request data to callData array
      await Promise.all(
        addresses.map(async (address, index) => {
          if (this.cacheTokenDetail.has(address)) {
            tokenDetails[index] = this.cacheTokenDetail.get(address);
          } else {
            const tokenCallData = await this.getTokenInfoCallData(address);
            const pairTokens = this.cachePairDetail.get(address);
            const toBeCalledInfo = {
              detailIndex: index,
              callDataIndex: callData.length,
              callDataLength: tokenCallData.length,
            };

            if (pairTokens) {
              toBeCalledInfo['token0Address'] = pairTokens[0];
              toBeCalledInfo['token1Address'] = pairTokens[1];
            }

            callInfo[index] = toBeCalledInfo;
            callData = callData.concat(tokenCallData);
          }
        }),
      );

      if (callData.length > 0) {
        // Aggegrate call get token detail
        const rawTokensDetail =
          await this.multicallService.partialAggregateCall(callData);

        // Transform return data and store to result array
        callInfo.map((info) => {
          const rawTokenDetail = rawTokensDetail.slice(
            info.callDataIndex,
            info.callDataIndex + info.callDataLength,
          );

          if (Array.isArray(rawTokenDetail)) {
            const [[tokenDecimals], [tokenName], [tokenSymbol]] =
              rawTokenDetail;

            let tokenDetail: TokenDetail = {
              tokenAddress: addresses[info.detailIndex],
              tokenName: tokenName,
              tokenSymbol: tokenSymbol,
              tokenDecimals: tokenDecimals,
            };

            if (info.callDataLength > 3) {
              const rawLpDetail = rawTokenDetail.slice(3);
              const [
                [token0Decimals],
                [token0Name],
                [token0Symbol],
                [token1Decimals],
                [token1Name],
                [token1Symbol],
              ] = rawLpDetail;

              tokenDetail = {
                ...tokenDetail,
                token0Address: info.token0Address,
                token0Name: token0Name,
                token0Symbol: token0Symbol,
                token0Decimals: token0Decimals,
                token1Address: info.token1Address,
                token1Name: token1Name,
                token1Symbol: token1Symbol,
                token1Decimals: token1Decimals,
              };
            }

            tokenDetails[info.detailIndex] = tokenDetail;
            // Store token detail to memory cache
            this.cacheTokenDetail.set(addresses[info.detailIndex], tokenDetail);
          } else {
            tokenDetails[info.detailIndex] = {
              tokenAddress: addresses[info.detailIndex],
              tokenName: 'unknown',
              tokenSymbol: 'unknown',
              tokenDecimals: 0,
            };

            this.logger.warn(`Invalid token detail: ${rawTokenDetail}`);
          }
        });
      }

      return tokenDetails;
    } catch (err) {
      this.logger.error(err);
      return [];
    }
  }

  // Return call data for aggregate call of token detail
  async getTokenInfoCallData(address: string): Promise<MulticallData[]> {
    // Check if token is lp token and store token0 token1 addressses
    const isLp = await this.checkLpToken(address);
    let callData: MulticallData[] = [];

    const detailFuncAbi = erc20Abi
      .filter((abi) => {
        return (
          abi.name === 'name' ||
          abi.name === 'symbol' ||
          abi.name === 'decimals'
        );
      })
      .sort((a, b) => {
        return a.name > b.name ? 1 : -1;
      });

    detailFuncAbi.map((abi) => {
      callData.push({
        address: address,
        name: abi.name,
        abi: abi,
        params: [],
      });
    });

    if (isLp) {
      const [token0, token1] = this.cachePairDetail.get(address);
      const token0CallData = detailFuncAbi.map((abi) => {
        return {
          address: token0,
          name: abi.name,
          abi: abi,
          params: [],
        };
      });
      const token1CallData = detailFuncAbi.map((abi) => {
        return {
          address: token1,
          name: abi.name,
          abi: abi,
          params: [],
        };
      });

      callData = [...callData, ...token0CallData, ...token1CallData];
    }

    return callData;
  }

  async getTokenInfo(address: string) {
    try {
      if (this.cacheTokenDetail.has(address))
        return this.cacheTokenDetail.get(address);

      const detailFuncAbi = erc20Abi.filter((abi) => {
        return (
          abi.name === 'name' ||
          abi.name === 'symbol' ||
          abi.name === 'decimals'
        );
      });

      const callData = detailFuncAbi.map((abi) => {
        const data: MulticallData = {
          address: address,
          name: abi.name,
          abi: abi,
          params: [],
        };

        return data;
      });

      // Aggegrate call get token detail
      const rawTokenDetail = await this.multicallService.aggegrateCall(
        callData,
      );
      const [[name], [symbol], [decimals]] = rawTokenDetail;

      const tokenDetail: TokenDetail = {
        tokenAddress: address,
        tokenName: name,
        tokenSymbol: symbol,
        tokenDecimals: decimals,
      };

      // Store token detail to memory cache
      this.cacheTokenDetail.set(address, tokenDetail);

      return tokenDetail;
    } catch (err) {
      this.logger.error(err);
      return {
        tokenAddress: address,
        tokenName: 'unknown',
        tokenSymbol: 'unknown',
        tokenDecimals: 0,
      };
    }
  }

  // Check if token is LP token and store token0, token1 value
  async checkLpToken(address: string): Promise<boolean> {
    const pairContract = new ethers.Contract(
      address,
      pairAbi,
      this.rpcProvider,
    );

    try {
      const [token0, token1] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
      ]);

      this.cachePairDetail.set(address, [token0, token1]);

      return true;
    } catch (err) {
      this.logger.log(`Check token ${address}: is not LP token`);
      return false;
    }
  }

  // Return pair reserves and totalsupply data
  async getPairReservesData(pairs: string[]) {
    const callData = this.getPairResrevesCallData(pairs);
    const rawPairsReservesData = await this.multicallService.aggegrateCall(
      callData,
    );

    return rawPairsReservesData;
  }

  // Return call data for aggregate call of reserves data
  private getPairResrevesCallData = (pairs: string[]) => {
    const callData: MulticallData[] = [];

    const pairReservesFuncAbi = pairAbi
      .filter((abi) => {
        return abi.name === 'getReserves' || abi.name === 'totalSupply';
      })
      .sort((a, b) => {
        return a.name > b.name ? 1 : -1;
      });

    pairs.map((pair) => {
      pairReservesFuncAbi.map((abi) => {
        callData.push({
          address: pair,
          name: abi.name,
          abi: abi,
          params: [],
        });
      });
    });

    return callData;
  };
}
