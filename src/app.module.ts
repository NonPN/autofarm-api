import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AutofarmModule } from './autofarm/autofarm.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: `./env/.env.${process.env.NODE_ENV}`,
      isGlobal: true,
    }),
    AutofarmModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
