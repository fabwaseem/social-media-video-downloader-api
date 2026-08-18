import { Logger } from "@nestjs/common";
import { createTransport } from "nodemailer";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../prisma/prisma.service";

/** DI token for the Better Auth instance. */
export const AUTH = Symbol("AUTH");

/** Inferred from the factory so plugin endpoints stay typed. */
export type Auth = Awaited<ReturnType<typeof createAuth>>;

const logger = new Logger("BetterAuth");

/**
 * Better Auth runs inside the API but is reached through the frontend proxy at
 * `<web origin>/api/auth/*` — a dedicated Next.js rewrite forwards that path
 * unchanged (unlike the general /api rewrite, which strips the prefix), so
 * basePath matches on both sides and OAuth callback URLs stay correct.
 */
// Better Auth ships ESM-only while this app compiles to CommonJS, so all
// value imports happen through dynamic import() (preserved by module=node16).
export async function createAuth(prisma: PrismaService, config: AppConfigService) {
  const [{ betterAuth }, { prismaAdapter }, { emailOTP }] = await Promise.all([
    import("better-auth"),
    import("better-auth/adapters/prisma"),
    import("better-auth/plugins"),
  ]);

  const secret = config.betterAuthSecret;
  if (!secret) {
    if (config.isProduction) {
      throw new Error("BETTER_AUTH_SECRET is required in production.");
    }
    logger.warn("BETTER_AUTH_SECRET not set — using an insecure development secret.");
  }

  const sendMail = buildMailer(config);

  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (config.googleClientId && config.googleClientSecret) {
    socialProviders.google = {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
    };
  }
  if (config.githubClientId && config.githubClientSecret) {
    socialProviders.github = {
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
    };
  }

  return betterAuth({
    appName: "Vidyoza",
    baseURL: config.betterAuthUrl,
    basePath: "/api/auth",
    secret: secret || "vidyoza-dev-secret-do-not-use-in-production",
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    trustedOrigins: [config.betterAuthUrl, ...config.allowedOrigins].filter(Boolean),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // OTP sign-in doubles as verification; hard-requiring it would dead-end
      // deploys that haven't configured SMTP yet.
      requireEmailVerification: false,
    },

    socialProviders,

    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        async sendVerificationOTP({ email, otp, type }) {
          const subject =
            type === "sign-in"
              ? "Your Vidyoza sign-in code"
              : type === "email-verification"
                ? "Verify your Vidyoza email"
                : "Reset your Vidyoza password";
          await sendMail(
            email,
            subject,
            `Your code is ${otp}. It expires in 10 minutes. If you didn't request it, ignore this email.`,
          );
        },
      }),
    ],

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh the expiry once per day of activity
      cookieCache: {
        // Signed cookie carries the session for 5 min — most requests skip the DB.
        enabled: true,
        maxAge: 300,
      },
    },

    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },

    advanced: {
      cookiePrefix: "vidyoza",
    },
  });
}

/** SMTP when configured; console logging otherwise so dev flows never block. */
function buildMailer(
  config: AppConfigService,
): (to: string, subject: string, text: string) => Promise<void> {
  const smtp = config.smtp;
  if (!smtp.host) {
    if (config.isProduction) {
      logger.warn("SMTP is not configured — OTP emails will only be logged, not delivered.");
    }
    return async (to, subject, text) => {
      logger.log(`[mail:dev] to=${to} subject="${subject}" body="${text}"`);
    };
  }

  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  return async (to, subject, text) => {
    await transport.sendMail({ from: smtp.from, to, subject, text });
  };
}
