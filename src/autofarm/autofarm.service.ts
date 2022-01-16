import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BigNumber, ethers } from 'ethers';
import { MulticallData } from 'src/multicall/multicall.model';
import { MulticallService } from 'src/multicall/multicall.service';
import { TokenService } from 'src/token/token.service';
import autoFarmAbi from './abi/autofarm.json';
import { Pool } from './autofarm.model';

@Injectable()
export class AutofarmService {
  private readonly logger = new Logger(AutofarmService.name);
  private autofarmAddress: string;
  private autofarmContract: ethers.Contract;
  private rpcProvider: string;
  private readonly deadPool = [331, 369];
  private AUTO_DECIMALS = 18;

  private cachedPools: Pool[] = [];

  constructor(
    private configService: ConfigService,
    private multicallService: MulticallService,
    private tokenService: TokenService,
  ) {
    this.rpcProvider = this.configService.get<string>('RPC_ENDPOINT');
    this.autofarmAddress = this.configService.get<string>('AUTOFARM_ADDRESS');
    this.autofarmContract = this.getAutofarmContract(
      this.autofarmAddress,
      autoFarmAbi,
    );
  }

  getAllPools() {
    return this.cachedPools;
  }

  async fetchAllPools() {
    const pids = [];
    const poolsLength = await this.getPoolsLength();
    const poolInfoFuncAbi = autoFarmAbi.filter(
      (abi) => abi.name === 'poolInfo',
    )[0];
    const callData = [];

    for (let i = 1; i < poolsLength; i++) {
      if (this.deadPool.includes(i)) continue;
      const data: MulticallData = {
        address: this.autofarmAddress,
        name: 'poolInfo',
        abi: poolInfoFuncAbi,
        params: [i],
      };

      pids.push(i);
      callData.push(data);
    }

    const poolsResult = await this.multicallService.aggegrateCall(callData);
    const wantAddresses = poolsResult.map((result) => result.want);

    const poolsTokenInfo = await this.tokenService.getTokenInfoBatch(
      wantAddresses,
    );

    const cleanPoolResult = [];
    for (let i = 0; i < poolsResult.length; i++) {
      const poolResult = poolsResult[i];
      cleanPoolResult[i] = {
        poolId: pids[i],
        ...poolsTokenInfo[i],
        allocPoint: poolResult.allocPoint.toNumber(),
        lastRewardBlock: poolResult.lastRewardBlock.toNumber(),
        stratAddress: poolResult.strat,
      };
    }

    this.cachedPools = cleanPoolResult;
    return this.cachedPools;
  }

  async getAddressStakedInfo(address: string) {
    // If non pool data exist, fetch new one
    if (this.cachedPools.length === 0) await this.fetchAllPools();

    const stakedInfoCallData = this.getStakedInfoCallData(
      address,
      this.cachedPools,
    );
    const rawStakedInfoResult = await this.multicallService.aggegrateCall(
      stakedInfoCallData,
    );

    const stakedInfoResult = this.cachedPools.map((pool, index) => {
      const rawIndex = index * 2;
      const stakedForPool = rawStakedInfoResult.slice(rawIndex, rawIndex + 2);

      return {
        pool: pool,
        balance: stakedForPool[1][0],
        reward: ethers.utils.formatUnits(
          stakedForPool[0][0],
          this.AUTO_DECIMALS,
        ),
      };
    });

    const addressStakedResult = stakedInfoResult.filter(
      (staked) => !staked.balance.eq(0) || staked.reward != '0.0',
    );

    const pairResult = addressStakedResult.filter(
      (result) => result.pool.token0Address,
    );

    const pairAddresses = pairResult.map((result) => result.pool.tokenAddress);
    const pairReservesData = await this.tokenService.getPairReservesData(
      pairAddresses,
    );

    let pairDataIndex = 0;
    const pairDataSize = 2;

    return addressStakedResult.map((result) => {
      let pairData;
      if (result.pool.token0Address) {
        pairData = pairReservesData.slice(
          pairDataIndex,
          pairDataIndex + pairDataSize,
        );
        pairDataIndex += pairDataSize;

        const [[reserve0, reserve1], [totalSupply]] = pairData;
        const token0Balance = reserve0.mul(result.balance).div(totalSupply);
        const token1Balance = reserve1.mul(result.balance).div(totalSupply);

        result['tokens'] = [
          {
            symbol: result.pool.token0Symbol,
            address: result.pool.token0Address,
            balance: ethers.utils.formatUnits(
              token0Balance,
              result.pool.token0Decimals,
            ),
          },
          {
            symbol: result.pool.token1Symbol,
            address: result.pool.token1Address,
            balance: ethers.utils.formatUnits(
              token1Balance,
              result.pool.token1Decimals,
            ),
          },
        ];

        result.balance = ethers.utils.formatUnits(
          result.balance,
          result.pool.tokenDecimals,
        );
      } else {
        result.balance = ethers.utils.formatUnits(
          result.balance,
          result.pool.tokenDecimals,
        );
        result['tokens'] = [
          {
            symbol: result.pool.tokenSymbol,
            address: result.pool.tokenAddress,
            balance: result.balance,
          },
        ];
      }

      delete result.pool;

      return result;
    });
  }

  private getStakedInfoCallData(address: string, pools: Array<Pool>) {
    const callData: MulticallData[] = [];
    const stakedInfoFuncAbi = autoFarmAbi
      .filter((abi) => {
        return abi.name === 'stakedWantTokens' || abi.name === 'pendingAUTO';
      })
      .sort((a, b) => {
        return a.name > b.name ? 1 : -1;
      });

    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      const [pendingAUTOAbi, stakedWantTokensAbi] = stakedInfoFuncAbi;

      // Create call data for aggregate call
      const pendingAUTOCallData: MulticallData = {
        address: this.autofarmAddress,
        name: pendingAUTOAbi.name,
        abi: pendingAUTOAbi,
        params: [pool.poolId, address],
      };
      const stakedWantTokensCallData: MulticallData = {
        address: this.autofarmAddress,
        name: stakedWantTokensAbi.name,
        abi: stakedWantTokensAbi,
        params: [pool.poolId, address],
      };
      callData.push(pendingAUTOCallData);
      callData.push(stakedWantTokensCallData);
    }

    return callData;
  }

  async getPoolsLength(): Promise<number> {
    const bigPoolsLength: BigNumber = await this.autofarmContract.poolLength();
    return bigPoolsLength.toNumber();
  }

  private getAutofarmContract(address: string, abi: Array<object>) {
    const provider = new ethers.providers.JsonRpcProvider(this.rpcProvider);
    return new ethers.Contract(address, abi, provider);
  }
}
