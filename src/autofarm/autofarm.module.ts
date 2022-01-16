import { Module } from '@nestjs/common';
import { MulticallModule } from 'src/multicall/multicall.module';
import { TokenModule } from 'src/token/token.module';
import { AutofarmController } from './autofarm.controller';
import { AutofarmService } from './autofarm.service';

@Module({
  imports: [MulticallModule, TokenModule],
  controllers: [AutofarmController],
  providers: [AutofarmService],
})
export class AutofarmModule {}
