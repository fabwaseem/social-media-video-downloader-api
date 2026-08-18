import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Exempts a route from the global access guard (API key / frontend secret). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
