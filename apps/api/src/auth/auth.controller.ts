import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FEATURE_FLAGS } from '../common/feature-flags';
import { Public } from '../common/decorators/public.decorator';
import type { AuthPrincipal } from '../common/types/principal';
import { AuthService } from './auth.service';
import { AttendantLoginDto } from './dto/attendant-login.dto';
import { AttendantNfcLoginDto } from './dto/attendant-nfc-login.dto';
import { MicrosoftCallbackDto } from './dto/microsoft-callback.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('microsoft/login')
  microsoftLoginConfig() {
    // Returns the MSAL public-client config the SPA needs to start its own
    // authorization-code + PKCE flow. The backend never handles the code
    // exchange itself — see MicrosoftOidcService for why.
    return this.auth.getMicrosoftClientConfig();
  }

  @Public()
  @Post('microsoft/callback')
  microsoftCallback(@Body() dto: MicrosoftCallbackDto) {
    return this.auth.loginWithMicrosoft(dto.idToken);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refreshStaffSession(dto.refreshToken);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('attendant/login')
  attendantLogin(@Body() dto: AttendantLoginDto) {
    return this.auth.loginAttendant(dto.employeeId, dto.pin);
  }

  /**
   * Silent session renewal for a device syncing an offline sales queue with
   * nobody logged in — exchanges a still-valid attendant refresh token for
   * a fresh access token, no PIN. Same throttle as login: a refresh token
   * is a bearer credential same as a PIN, worth rate-limiting guesses/abuse.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('attendant/refresh')
  attendantRefresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refreshAttendantSession(dto.refreshToken);
  }

  /**
   * Badge-tap login — no PIN. Same throttle as PIN login: a wrong/unregistered
   * tag isn't a guessable secret, but this still caps how fast a scanning
   * device (or someone probing) can hammer the endpoint.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('attendant/nfc-login')
  attendantNfcLogin(@Body() dto: AttendantNfcLoginDto) {
    if (!FEATURE_FLAGS.attendantNfcLogin) {
      throw new BadRequestException('This feature is currently disabled');
    }
    return this.auth.loginAttendantByNfcTag(dto.tagId);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout() {
    // Sessions are stateless short-lived JWTs; the client discards them.
    // Session-expiry itself is enforced by the token TTLs in TokenService.
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal) {
    return user;
  }
}
