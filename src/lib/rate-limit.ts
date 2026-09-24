// Simple in-memory rate limiter
// For production, use Redis or similar

interface RateLimitEntry {
  count: number
  resetAt: number
}

const limits = new Map<string, RateLimitEntry>()

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of limits) {
    if (now > entry.resetAt) {
      limits.delete(key)
    }
  }
}, 5 * 60 * 1000)

export interface RateLimitOptions {
  /** Max requests per window */
  maxRequests: number
  /** Window duration in milliseconds */
  windowMs: number
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  maxRequests: 10,
  windowMs: 60 * 1000, // 1 minute
}

/**
 * Check if a request should be rate limited.
 * Returns true if the request is allowed, false if it should be rejected.
 */
export function checkRateLimit(
  identifier: string,
  options: Partial<RateLimitOptions> = {}
): { allowed: boolean; remaining: number; resetAt: number } {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const now = Date.now()

  const entry = limits.get(identifier)

  if (!entry || now > entry.resetAt) {
    // New window
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + opts.windowMs,
    }
    limits.set(identifier, newEntry)
    return {
      allowed: true,
      remaining: opts.maxRequests - 1,
      resetAt: newEntry.resetAt,
    }
  }

  if (entry.count >= opts.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    }
  }

  entry.count++
  return {
    allowed: true,
    remaining: opts.maxRequests - entry.count,
    resetAt: entry.resetAt,
  }
}

/**
 * Get client identifier from request (IP address or forwarded header)
 */
export function getClientIdentifier(request: Request): string {
  // Check forwarded headers first (for reverse proxies)
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  // Fallback - use user agent as weak identifier
  const ua = request.headers.get('user-agent') || 'unknown'
  return `ua-${ua.slice(0, 50)}`
}
