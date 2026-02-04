"use node";

/**
 * Quinn Browser Actions
 * AGT-240: Convex actions for headless browser testing
 *
 * TEMPORARY: Disabled due to Playwright bundling issues with Convex.
 * Playwright has complex dependencies (chromium-bidi) that can't be bundled.
 * TODO: Move browser testing to external HTTP endpoint or standalone script.
 *
 * Provides Quinn with browser capabilities to:
 * - Capture screenshots of localhost:3000
 * - Check for console errors
 * - Verify UI elements exist
 *
 * NOTE: This file requires Node.js runtime for Playwright browser automation
 */

import { action } from "./_generated/server";
import { v } from "convex/values";
// TEMPORARILY DISABLED - Playwright bundling issues
// import {
//   captureScreenshot,
//   checkConsoleErrors,
//   verifyElementExists,
//   comprehensiveCheck,
// } from "../lib/evox/quinn-browser";

/**
 * Capture a screenshot of a page
 */
export const screenshot = action({
  args: {
    url: v.string(),
    timeout: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await captureScreenshot({
      url: args.url,
      timeout: args.timeout,
      headless: true,
    });

    if (!result.success) {
      throw new Error(`Screenshot failed: ${result.error}`);
    }

    return {
      screenshot: result.screenshot!,
    };
  },
});

/**
 * Check for console errors on a page
 */
export const checkErrors = action({
  args: {
    url: v.string(),
    timeout: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await checkConsoleErrors({
      url: args.url,
      timeout: args.timeout,
      headless: true,
    });

    if (!result.success) {
      throw new Error(`Console check failed: ${result.error}`);
    }

    return {
      hasErrors: (result.consoleErrors?.length ?? 0) > 0,
      errors: result.consoleErrors ?? [],
    };
  },
});

/**
 * Verify a UI element exists
 */
export const verifyElement = action({
  args: {
    url: v.string(),
    selector: v.string(),
    timeout: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await verifyElementExists(
      {
        url: args.url,
        timeout: args.timeout,
        headless: true,
      },
      args.selector
    );

    if (!result.success) {
      throw new Error(`Element verification failed: ${result.error}`);
    }

    return {
      exists: result.elementExists!,
      screenshot: result.screenshot, // Included if element not found
    };
  },
});

/**
 * Comprehensive check - screenshot + errors + elements
 * This is the main action Quinn should use
 */
export const comprehensivePageCheck = action({
  args: {
    url: v.string(),
    selectors: v.optional(v.array(v.string())),
    timeout: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await comprehensiveCheck(
      {
        url: args.url,
        timeout: args.timeout,
        headless: true,
      },
      args.selectors
    );

    if (!result.success) {
      throw new Error(`Comprehensive check failed: ${result.error}`);
    }

    return {
      screenshot: result.screenshot!,
      hasErrors: (result.consoleErrors?.length ?? 0) > 0,
      errors: result.consoleErrors ?? [],
      elementsFound: result.elementsFound,
      summary: {
        totalErrors: result.consoleErrors?.length ?? 0,
        totalElements: args.selectors?.length ?? 0,
        elementsExist: args.selectors
          ? Object.values(result.elementsFound ?? {}).filter(Boolean).length
          : 0,
      },
    };
  },
});

/**
 * Quick health check - localhost:3000 with common selectors
 */
export const quickHealthCheck = action({
  args: {},
  handler: async (ctx) => {
    const commonSelectors = [
      "body",
      "main",
      "nav",
      "[data-testid]", // Any element with test id
    ];

    const result = await comprehensiveCheck(
      {
        url: "http://localhost:3000",
        timeout: 30000,
        headless: true,
      },
      commonSelectors
    );

    if (!result.success) {
      throw new Error(`Health check failed: ${result.error}`);
    }

    const allElementsExist = commonSelectors.every(
      (selector) => result.elementsFound?.[selector] === true
    );

    return {
      healthy: allElementsExist && (result.consoleErrors?.length ?? 0) === 0,
      screenshot: result.screenshot!,
      errors: result.consoleErrors ?? [],
      elementsFound: result.elementsFound,
    };
  },
});
