import { Module } from '@nestjs/common';
import { MulticallModule } from 'src/multicall/multicall.module';
import { TokenService } from './token.service';

@Module({
  imports: [MulticallModule],
  providers: [TokenService],
  exports: [TokenService],
})
export class TokenModule {}
