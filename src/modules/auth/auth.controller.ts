import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import * as ms from 'ms';
import type { StringValue } from 'ms';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiCookieAuth } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { THROTTLE_LIMITS } from '../../config/throttle-limits';

const loginThrottleLimit = THROTTLE_LIMITS.login;

/** Name of the HttpOnly cookie that carries the refresh token. */
export const REFRESH_COOKIE_NAME = 'refresh_token';
/** The browser only sends the cookie to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * TRANSITIONAL: the body field is still accepted for one release so clients
 * that kept the refresh token in storage keep working. Remove it afterwards;
 * the refresh token must travel only in the HttpOnly cookie.
 */
class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}

const INVALID_REFRESH_MESSAGE = 'Refresh token inválido o expirado. Iniciá sesión nuevamente.';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /** Flags shared by set and clear, so the browser matches the same cookie. */
  private refreshCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      // false outside production so plain-http localhost and e2e runs work.
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    };
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    const expiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...this.refreshCookieOptions(),
      // Express writes maxAge (ms) as Max-Age (s): same lifetime as the JWT.
      maxAge: ms(expiresIn as StringValue),
    });
  }

  /**
   * POST /api/v1/auth/login
   * Endpoint público. Devuelve accessToken + datos del usuario; el refresh token
   * viaja sólo en la cookie HttpOnly `refresh_token`.
   * Limitado a 5 intentos por minuto por IP para frenar fuerza bruta.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: loginThrottleLimit } })
  @ApiOperation({ summary: 'Iniciar sesión (setea la cookie refresh_token)' })
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, ...result } = await this.authService.login(loginDto);
    this.setRefreshCookie(res, refreshToken);
    return result;
  }

  /**
   * POST /api/v1/auth/refresh
   * Renueva el par de tokens. Lee el refresh token de la cookie `refresh_token`
   * (transitoriamente también del body `refreshToken`), rota la cookie y
   * devuelve sólo `{ accessToken }`.
   * Limitado a 20 intentos por minuto por IP.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: THROTTLE_LIMITS.refresh } })
  @ApiOperation({ summary: 'Renovar access token (usa la cookie refresh_token)' })
  @ApiCookieAuth(REFRESH_COOKIE_NAME)
  @ApiBody({
    type: RefreshTokenDto,
    required: false,
    description: 'Deprecated, transitional: send the refresh_token cookie instead.',
  })
  async refresh(
    @Req() req: Request,
    @Body() body: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    // TRANSITIONAL body fallback, see RefreshTokenDto.
    const token = cookies?.[REFRESH_COOKIE_NAME] ?? body?.refreshToken;
    if (!token) {
      throw new UnauthorizedException(INVALID_REFRESH_MESSAGE);
    }
    const { accessToken, refreshToken } = await this.authService.refreshToken(token);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  /**
   * POST /api/v1/auth/logout
   * Cierra la sesión en el servidor: el access token y el refresh token
   * de la sesión actual dejan de servir en el acto, y se borra la cookie.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cerrar sesión' })
  async logout(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(userId);
    res.clearCookie(REFRESH_COOKIE_NAME, this.refreshCookieOptions());
  }

  /**
   * GET /api/v1/auth/me
   * Retorna el perfil del usuario autenticado.
   * El Angular lo usa al recargar la página para restaurar la sesión.
   */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener perfil del usuario autenticado' })
  async getProfile(@CurrentUser() user: User) {
    return this.authService.getProfile(user.id);
  }

  /**
   * PATCH /api/v1/auth/me/password
   * Permite a cualquier usuario autenticado cambiar su propia contraseña.
   * Requiere la contraseña actual para verificar identidad.
   * Limpia el flag `mustChangePassword` al completar.
   */
  @Patch('me/password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar contraseña propia' })
  async changeOwnPassword(@CurrentUser('id') userId: string, @Body() dto: ChangeOwnPasswordDto) {
    return this.authService.changeOwnPassword(userId, dto);
  }
}
