import { INestApplication, VersioningType } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { HealthController } from "../src/health/health.controller";
import { BinariesService } from "../src/engine/binaries.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { StorageService } from "../src/storage/storage.service";
import { StorageQuotaService } from "../src/storage/storage-quota.service";

describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: BinariesService,
          useValue: {
            versions: async () => ({
              ytdlp: "2026.08.19",
              ytdlpSource: "system",
              pluginDir: null,
              ffmpeg: true,
              jsRuntime: "node",
              error: null,
            }),
          },
        },
        { provide: PrismaService, useValue: { $queryRaw: async () => 1 } },
        { provide: StorageService, useValue: { remote: false } },
        { provide: StorageQuotaService, useValue: { status: async () => ({}) } },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "2" });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /v2/health returns engine status", () => {
    return request(app.getHttpServer())
      .get("/v2/health")
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe("ok");
        expect(res.body.database).toBe(true);
        expect(res.body.engine.ytdlpVersion).toBe("2026.08.19");
      });
  });

  it("GET / is not a route", () => {
    return request(app.getHttpServer()).get("/").expect(404);
  });
});
