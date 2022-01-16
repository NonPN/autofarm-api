import { Module } from '@nestjs/common';
import { MulticallService } from './multicall.service';

@Module({
  imports: [],
  controllers: [],
  providers: [MulticallService],
  exports: [MulticallService],
})
export class MulticallModule {}
