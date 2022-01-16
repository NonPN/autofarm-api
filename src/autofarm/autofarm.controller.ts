import { Controller, Get, Injectable, Logger, Param } from '@nestjs/common';
import { Pool } from './autofarm.model';
import { AutofarmService } from './autofarm.service';

@Injectable()
@Controller('autofarm')
export class AutofarmController {
  private readonly logger = new Logger(AutofarmController.name);

  constructor(private autofarmService: AutofarmService) {}

  @Get('cache/update')
  async updateAndReturnPools() {
    // Fetch new pools data from chain
    const pools = await this.autofarmService.fetchAllPools();
    return {
      pools: pools,
    };
  }

  @Get(':address')
  async getStakedInfo(@Param('address') address: string) {
    const addressStakedResult = await this.autofarmService.getAddressStakedInfo(
      address,
    );
    return {
      farms: addressStakedResult,
    };
  }
}
