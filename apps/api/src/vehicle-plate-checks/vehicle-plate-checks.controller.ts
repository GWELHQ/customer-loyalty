import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AttendantOnly } from '../common/decorators/attendant-only.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AttendantPrincipal } from '../common/types/principal';
import { VehiclePlateChecksService } from './vehicle-plate-checks.service';

/**
 * Called by the Android app after the customer is chosen (by phone/QR/NFC)
 * and before the attendant enters the amount — the photo is checked
 * immediately so the app can show the result on-screen, and the returned
 * `id` is carried into `POST /mobile/sales`/`sync` as `plateCheckId`.
 */
@ApiTags('mobile')
@ApiBearerAuth()
@AttendantOnly()
@Controller('mobile/vehicle-plate-checks')
export class VehiclePlateChecksController {
  constructor(private readonly plateChecks: VehiclePlateChecksService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image'))
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body('customerId') customerId: string,
    @CurrentUser() actor: AttendantPrincipal,
  ) {
    if (!customerId) throw new BadRequestException('customerId is required');
    if (!file) throw new BadRequestException('image is required');
    return this.plateChecks.create(customerId, file, actor);
  }
}
