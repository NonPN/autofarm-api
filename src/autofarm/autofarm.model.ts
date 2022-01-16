import { TokenDetail } from 'src/token/token.model';

export interface Pool extends TokenDetail {
  poolId: number;
  allocPoint: number;
  lastRewardBlock: number;
  stratAddress: string;
}

export interface UserInfo {
  staked: number;
  reward: number;
}
