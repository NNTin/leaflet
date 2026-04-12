/**
 * OpenAPI 3.0.3 specification for the Leaflet API.
 *
 * This file is the single source of truth for the API contract.
 * Edit this file to update the spec.
 * The spec is imported directly at runtime and also written to dist/openapi.json during build.
 */

import { SHORTEN_TTL_VALUES } from './shorten-policy';

/** Minimal OpenAPI 3.0.x document shape for compile-time safety. */
export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
  };
  /** Overwritten at runtime by app.ts with the configured PUBLIC_API_ORIGIN. */
  servers: Array<{ url: string; description: string }>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
    headers?: Record<string, unknown>;
    responses?: Record<string, unknown>;
  };
  paths: Record<string, Record<string, unknown>>;
}

const shortenTtlEnum = [...SHORTEN_TTL_VALUES];

const spec: OpenApiDocument = {
  "openapi": "3.0.3",
  "info": {
    "title": "Leaflet URL Shortener API",
    "description": "Privacy-first URL shortener backend API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "http://localhost:3001",
      "description": "Configured API server"
    }
  ],
  "components": {
    "headers": {
      "RateLimit": {
        "description": "IETF draft-8 RateLimit header describing the active quota.",
        "schema": {
          "type": "string"
        }
      },
      "RateLimit-Policy": {
        "description": "IETF draft-8 RateLimit-Policy header describing the rate-limit policy.",
        "schema": {
          "type": "string"
        }
      },
      "Retry-After": {
        "description": "Number of seconds to wait before retrying the request.",
        "schema": {
          "type": "integer"
        }
      }
    },
    "responses": {
      "TooManyRequests": {
        "description": "Rate limit exceeded.",
        "headers": {
          "RateLimit": {
            "$ref": "#/components/headers/RateLimit"
          },
          "RateLimit-Policy": {
            "$ref": "#/components/headers/RateLimit-Policy"
          },
          "Retry-After": {
            "$ref": "#/components/headers/Retry-After"
          }
        },
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      }
    },
    "securitySchemes": {
      "sessionCookie": {
        "type": "apiKey",
        "in": "cookie",
        "name": "connect.sid"
      },
      "BearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "OAuth 2.0 access token"
      }
    },
    "schemas": {
      "User": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "username": {
            "type": "string"
          },
          "role": {
            "type": "string",
            "enum": [
              "user",
              "privileged",
              "admin"
            ]
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "ShortUrl": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "shortCode": {
            "type": "string"
          },
          "originalUrl": {
            "type": "string"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "expiresAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          },
          "isCustom": {
            "type": "boolean"
          },
          "createdBy": {
            "type": "string",
            "nullable": true
          }
        }
      },
      "ShortenTtlOption": {
        "type": "object",
        "properties": {
          "value": {
            "type": "string",
            "enum": shortenTtlEnum
          },
          "label": {
            "type": "string"
          }
        },
        "required": [
          "value",
          "label"
        ]
      },
      "ShortenCapabilities": {
        "type": "object",
        "properties": {
          "authenticated": {
            "type": "boolean"
          },
          "anonymous": {
            "type": "boolean"
          },
          "role": {
            "type": "string",
            "enum": [
              "user",
              "privileged",
              "admin"
            ],
            "nullable": true
          },
          "shortenAllowed": {
            "type": "boolean",
            "description": "Whether the current caller can create short links with its current session or token scopes."
          },
          "aliasingAllowed": {
            "type": "boolean"
          },
          "neverAllowed": {
            "type": "boolean"
          },
          "ttlOptions": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ShortenTtlOption"
            }
          }
        },
        "required": [
          "authenticated",
          "anonymous",
          "role",
          "shortenAllowed",
          "aliasingAllowed",
          "neverAllowed",
          "ttlOptions"
        ]
      },
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        }
      },
      "ErrorResponse": {
        "type": "object",
        "properties": {
          "success": {
            "type": "boolean",
            "example": false
          },
          "error": {
            "type": "string"
          },
          "hint": {
            "type": "string"
          }
        }
      },
      "Identity": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "provider": {
            "type": "string",
            "enum": [
              "github",
              "google",
              "discord",
              "microsoft",
              "apple"
            ]
          },
          "displayName": {
            "type": "string",
            "nullable": true
          },
          "email": {
            "type": "string",
            "nullable": true
          },
          "emailVerified": {
            "type": "boolean"
          },
          "connectedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "OAuthError": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "error_description": {
            "type": "string"
          }
        }
      },
      "TokenResponse": {
        "type": "object",
        "properties": {
          "access_token": {
            "type": "string"
          },
          "token_type": {
            "type": "string",
            "enum": [
              "Bearer"
            ]
          },
          "expires_in": {
            "type": "integer",
            "description": "Seconds until the access token expires"
          },
          "refresh_token": {
            "type": "string"
          },
          "scope": {
            "type": "string"
          }
        }
      },
      "OAuthClient": {
        "type": "object",
        "properties": {
          "clientId": {
            "type": "string"
          },
          "clientSecret": {
            "type": "string",
            "nullable": true,
            "description": "Raw secret shown only at registration time; null for public clients"
          },
          "name": {
            "type": "string"
          },
          "isPublic": {
            "type": "boolean"
          },
          "redirectUris": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "scopes": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "ConsentedApp": {
        "type": "object",
        "properties": {
          "clientId": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "scopes": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "grantedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    }
  },
  "paths": {
    "/auth/csrf-token": {
      "get": {
        "summary": "Get a CSRF token for the current session",
        "tags": [
          "Auth"
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "CSRF token to include as X-CSRF-Token header in mutating requests",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "csrfToken": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/providers": {
      "get": {
        "summary": "List configured OAuth providers",
        "description": "Returns the OAuth providers that are currently configured and available on this server. Only providers with valid credentials registered at startup are included.",
        "tags": [
          "Auth"
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Array of available providers",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "enum": ["github", "google", "discord", "microsoft", "apple"],
                        "description": "Provider identifier used in OAuth URLs"
                      },
                      "label": {
                        "type": "string",
                        "description": "Human-readable provider name"
                      }
                    },
                    "required": ["name", "label"]
                  }
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/{provider}": {
      "get": {
        "summary": "Initiate OAuth login for a provider",
        "description": "Starts the provider login flow and stores a validated `returnTo` target in the current browser session. On the `https://nntin.xyz` Pages origin, Leaflet only accepts `returnTo` URLs under `/leaflet/...` and `/leafspots/...`. If `returnTo` is omitted or invalid, the backend falls back to the configured default frontend URL.",
        "tags": [
          "Auth"
        ],
        "parameters": [
          {
            "name": "provider",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "enum": [
                "github",
                "google",
                "discord",
                "microsoft",
                "apple"
              ]
            }
          },
          {
            "name": "returnTo",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            },
            "description": "Frontend URL to redirect to after the auth callback completes. The backend validates this against the configured frontend origins and allowed path prefixes."
          }
        ],
        "responses": {
          "302": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Redirects to the provider OAuth authorization page"
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Unknown provider"
          },
          "503": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Provider not configured on this server"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/{provider}/link": {
      "get": {
        "summary": "Link an additional provider to the currently authenticated account",
        "tags": [
          "Auth"
        ],
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "parameters": [
          {
            "name": "provider",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "enum": [
                "github",
                "google",
                "discord",
                "microsoft",
                "apple"
              ]
            }
          },
          {
            "name": "returnTo",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "302": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Redirects to the provider OAuth flow"
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Unknown provider"
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Not authenticated"
          },
          "503": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Provider not configured"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/{provider}/callback": {
      "get": {
        "summary": "OAuth callback route for provider authentication",
        "description": "Handles callback redirects for GET-based providers. On success, Leaflet redirects the browser to the stored `returnTo` URL. If provider authentication fails, Leaflet redirects to that same URL with `auth=failed` added to the query string. `GET /auth/apple/callback` is rejected with `405 Method Not Allowed` because Apple Sign In uses `POST /auth/apple/callback` with `form_post` response mode.",
        "tags": [
          "Auth"
        ],
        "parameters": [
          {
            "name": "provider",
            "in": "path",
            "required": true,
            "description": "Provider name. Apple is POST-only and returns 405 on this GET route.",
            "schema": {
              "type": "string",
              "enum": [
                "github",
                "google",
                "discord",
                "microsoft",
                "apple"
              ]
            }
          }
        ],
        "responses": {
          "302": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Redirects to frontend after authentication (with ?auth=link_conflict on conflict)"
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Unknown provider",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "405": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Apple Sign In requires POST /auth/apple/callback",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "503": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Provider not configured on this server",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/apple/callback": {
      "post": {
        "summary": "Apple OAuth callback (form_post response mode)",
        "description": "Handles the Apple Sign In callback. On success, Leaflet redirects the browser to the stored `returnTo` URL. If provider authentication fails, Leaflet redirects to that same URL with `auth=failed` added to the query string.",
        "tags": [
          "Auth"
        ],
        "responses": {
          "302": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Redirects to frontend after authentication"
          },
          "503": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Apple provider not configured on this server",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/me": {
      "get": {
        "summary": "Get current authenticated user",
        "tags": [
          "Auth"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Current user (with optional scopes for OAuth tokens) or null if not authenticated",
            "content": {
              "application/json": {
                "schema": {
                  "oneOf": [
                    {
                      "allOf": [
                        {
                          "$ref": "#/components/schemas/User"
                        },
                        {
                          "type": "object",
                          "properties": {
                            "scopes": {
                              "type": "array",
                              "items": {
                                "type": "string"
                              },
                              "description": "Granted OAuth scopes (only present for OAuth token requests)"
                            }
                          }
                        }
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Bearer token is invalid or expired",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "OAuth token lacks the required user:read scope",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "string"
                    },
                    "hint": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      },
      "delete": {
        "summary": "Delete the current authenticated user's account",
        "description": "Permanently deletes the authenticated user's account and all associated data. The session is invalidated on success.",
        "tags": [
          "Auth"
        ],
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Account deleted successfully",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Not authenticated"
          },
          "500": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Internal server error"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/identities": {
      "get": {
        "summary": "List connected provider identities for the current user",
        "tags": [
          "Auth"
        ],
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Array of connected identities",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Identity"
                  }
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Not authenticated"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/identities/{provider}": {
      "delete": {
        "summary": "Disconnect a provider identity from the current account",
        "tags": [
          "Auth"
        ],
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "parameters": [
          {
            "name": "provider",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "enum": [
                "github",
                "google",
                "discord",
                "microsoft",
                "apple"
              ]
            }
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Identity disconnected successfully",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Cannot disconnect the only remaining identity, or unknown provider",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Not authenticated"
          },
          "404": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Identity not found for this user"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/logout": {
      "post": {
        "summary": "Log out current session",
        "tags": [
          "Auth"
        ],
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Successfully logged out",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/merge/initiate": {
      "post": {
        "summary": "Initiate an account merge (returns a one-time confirmation token)",
        "description": "Begins the two-step merge flow.  The caller must already be authenticated\nas the *surviving* user.  The response contains a `mergeToken` that must\nbe echoed back to `POST /auth/merge/confirm` within 10 minutes.\n",
        "tags": [
          "Auth"
        ],
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "targetUserId"
                ],
                "properties": {
                  "targetUserId": {
                    "type": "integer",
                    "description": "ID of the user account to be merged into the current account"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Merge token issued",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "mergeToken": {
                      "type": "string"
                    },
                    "targetUser": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "integer"
                        },
                        "username": {
                          "type": "string"
                        }
                      }
                    },
                    "expiresAt": {
                      "type": "string",
                      "format": "date-time"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Missing targetUserId, self-merge, or invalid input",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Not authenticated"
          },
          "404": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Target user not found"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/auth/merge/confirm": {
      "post": {
        "summary": "Confirm and execute a previously initiated account merge",
        "tags": [
          "Auth"
        ],
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "mergeToken"
                ],
                "properties": {
                  "mergeToken": {
                    "type": "string",
                    "description": "Token returned by POST /auth/merge/initiate"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Merge completed successfully",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "success": {
                      "type": "boolean"
                    },
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Missing token, no pending merge, or token expired",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Not authenticated"
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Token mismatch"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/oauth/authorize": {
      "get": {
        "summary": "OAuth 2.0 Authorization endpoint",
        "description": "Presents a consent screen to the authenticated user.\nRequires the user to be logged in via a browser session (GitHub OAuth).\nPublic clients must include a PKCE code_challenge.\n",
        "tags": [
          "OAuth"
        ],
        "parameters": [
          {
            "name": "response_type",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string",
              "enum": [
                "code"
              ]
            }
          },
          {
            "name": "client_id",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "redirect_uri",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "scope",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string",
              "description": "Space-separated list of requested scopes"
            }
          },
          {
            "name": "state",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "code_challenge",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "description": "Base64url-encoded SHA-256 of the code_verifier (required for public clients)"
            }
          },
          {
            "name": "code_challenge_method",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "enum": [
                "S256"
              ]
            }
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "HTML consent page",
            "content": {
              "text/html": {
                "schema": {
                  "type": "string"
                }
              }
            }
          },
          "302": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Redirect to redirect_uri with code or error"
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Invalid request parameters",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/OAuthError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
        "/oauth/authorize/consent": {
      "post": {
        "summary": "Submit OAuth consent",
        "description": "Handles the HTML form submission from the OAuth consent screen.",
        "tags": [
          "OAuth"
        ],
        "security": [
          {
            "sessionCookie": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/x-www-form-urlencoded": {
              "schema": {
                "type": "object",
                "required": ["_csrf", "action"],
                "properties": {
                  "_csrf": { "type": "string" },
                  "action": {
                    "type": "string",
                    "enum": ["allow", "deny"]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "302": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Redirects to redirect_uri with authorization code or error"
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "CSRF validation failed"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }
        }
      }
    },
    "/oauth/token": {
      "post": {
        "summary": "OAuth 2.0 Token endpoint",
        "description": "Exchanges an authorization code for tokens, or refreshes tokens.\nUses application/x-www-form-urlencoded request body.\nNo CSRF token required.\n",
        "tags": [
          "OAuth"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/x-www-form-urlencoded": {
              "schema": {
                "type": "object",
                "required": [
                  "grant_type",
                  "client_id"
                ],
                "properties": {
                  "grant_type": {
                    "type": "string",
                    "enum": [
                      "authorization_code",
                      "refresh_token"
                    ]
                  },
                  "client_id": {
                    "type": "string"
                  },
                  "client_secret": {
                    "type": "string",
                    "description": "Required for confidential clients"
                  },
                  "code": {
                    "type": "string",
                    "description": "Required for authorization_code grant"
                  },
                  "redirect_uri": {
                    "type": "string",
                    "description": "Required for authorization_code grant; must match original"
                  },
                  "code_verifier": {
                    "type": "string",
                    "description": "PKCE verifier; required when code_challenge was used"
                  },
                  "refresh_token": {
                    "type": "string",
                    "description": "Required for refresh_token grant"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Token response",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/TokenResponse"
                }
              }
            }
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Invalid request or grant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/OAuthError"
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Invalid client credentials",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/OAuthError"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/oauth/revoke": {
      "post": {
        "summary": "OAuth 2.0 Token Revocation endpoint (RFC 7009)",
        "description": "Revokes an access or refresh token. Always returns 200.\nUses application/x-www-form-urlencoded request body.\n",
        "tags": [
          "OAuth"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/x-www-form-urlencoded": {
              "schema": {
                "type": "object",
                "required": [
                  "token",
                  "client_id"
                ],
                "properties": {
                  "token": {
                    "type": "string"
                  },
                  "token_type_hint": {
                    "type": "string",
                    "enum": [
                      "access_token",
                      "refresh_token"
                    ]
                  },
                  "client_id": {
                    "type": "string"
                  },
                  "client_secret": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Revocation acknowledged (regardless of whether the token existed)"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/oauth/apps": {
      "get": {
        "summary": "List apps the authenticated user has authorized",
        "tags": [
          "OAuth"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "List of consented applications",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/ConsentedApp"
                  }
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Authentication required"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      },
      "post": {
        "summary": "Register a new OAuth client application",
        "tags": [
          "OAuth"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name",
                  "redirectUris",
                  "scopes",
                  "isPublic"
                ],
                "properties": {
                  "name": {
                    "type": "string"
                  },
                  "redirectUris": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "scopes": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "enum": [
                        "shorten:create",
                        "shorten:create:never",
                        "shorten:create:alias",
                        "urls:read",
                        "urls:delete",
                        "users:read",
                        "users:write",
                        "user:read",
                        "oauth:apps:read",
                        "oauth:apps:write",
                        "admin:*"
                      ]
                    }
                  },
                  "isPublic": {
                    "type": "boolean"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Client registered; clientSecret is shown only once",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/OAuthClient"
                }
              }
            }
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Validation error"
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Authentication required"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/oauth/apps/{clientId}": {
      "delete": {
        "summary": "Revoke an OAuth client and all its active tokens",
        "description": "Owner or admin only.",
        "tags": [
          "OAuth"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "clientId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Application revoked"
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Authentication required"
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Forbidden"
          },
          "404": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Client not found"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/api/shorten/capabilities": {
      "get": {
        "summary": "Discover shorten capabilities for the current caller",
        "description": "Returns the currently available shorten options for the caller's browser session or OAuth token. Leafspots can use this to discover valid TTL values, labels, and whether aliasing or never-expiring links are currently allowed.",
        "tags": [
          "URLs"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Capabilities available to the current caller",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ShortenCapabilities"
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Bearer token is invalid or expired",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/api/public/shorten/capabilities": {
      "get": {
        "summary": "Discover public shorten capabilities",
        "description": "Returns the currently available shorten options for the public cross-origin browser API. This endpoint does not rely on browser sessions and only uses OAuth bearer auth when a bearer token is explicitly provided.",
        "tags": [
          "URLs"
        ],
        "security": [
          {
            "BearerAuth": []
          },
          {}
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Capabilities available to the current caller",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ShortenCapabilities"
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Bearer token is invalid or expired",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Bearer token lacks the required user:read scope",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/api/shorten": {
      "post": {
        "summary": "Create a short URL",
        "tags": [
          "URLs"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "url",
                  "ttl"
                ],
                "properties": {
                  "url": {
                    "type": "string",
                    "format": "uri",
                    "description": "The URL to shorten"
                  },
                  "ttl": {
                    "type": "string",
                    "enum": shortenTtlEnum,
                    "description": "Time-to-live. \"never\" is admin only."
                  },
                  "alias": {
                    "type": "string",
                    "minLength": 3,
                    "maxLength": 50,
                    "description": "Custom short code alias. Privileged/admin only."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Short URL created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "shortCode": {
                      "type": "string"
                    },
                    "shortUrl": {
                      "type": "string"
                    },
                    "expiresAt": {
                      "type": "string",
                      "format": "date-time",
                      "nullable": true
                    }
                  }
                }
              }
            }
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Validation error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Forbidden - insufficient permissions",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Alias already in use",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }
        }
      }
    },
    "/api/public/shorten": {
      "post": {
        "summary": "Create a short URL from a public browser origin",
        "description": "Cross-origin shortening endpoint for third-party sites. This route does not use browser sessions or CSRF tokens; OAuth bearer tokens are optional.",
        "tags": [
          "URLs"
        ],
        "security": [
          {
            "BearerAuth": []
          },
          {}
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "url",
                  "ttl"
                ],
                "properties": {
                  "url": {
                    "type": "string",
                    "format": "uri",
                    "description": "The URL to shorten"
                  },
                  "ttl": {
                    "type": "string",
                    "enum": shortenTtlEnum,
                    "description": "Time-to-live. \"never\" is admin only."
                  },
                  "alias": {
                    "type": "string",
                    "minLength": 3,
                    "maxLength": 50,
                    "description": "Custom short code alias. Privileged/admin only."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Short URL created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "shortCode": {
                      "type": "string"
                    },
                    "shortUrl": {
                      "type": "string"
                    },
                    "expiresAt": {
                      "type": "string",
                      "format": "date-time",
                      "nullable": true
                    }
                  }
                }
              }
            }
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Validation error",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Bearer token is invalid or expired",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Forbidden - insufficient permissions",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Alias already in use",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }
        }
      }
    },
    "/api/openapi.json": {
      "get": {
        "summary": "Get the OpenAPI specification",
        "tags": [
          "Meta"
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "OpenAPI 3.0 specification document",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }
        }
      }
    },
    "/api/{code}": {
      "get": {
        "summary": "Redirect to original URL",
        "tags": [
          "URLs"
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "302": {
            "description": "Temporary redirect to the original URL"
          },
          "404": {
            "description": "Short URL not found or expired",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/s/{code}": {
      "get": {
        "summary": "Canonical short-link redirect",
        "tags": [
          "URLs"
        ],
        "parameters": [
          {
            "name": "code",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "302": {
            "description": "Temporary redirect to the original URL"
          },
          "404": {
            "description": "Short URL not found or expired",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/urls": {
      "get": {
        "summary": "List all URLs (admin only)",
        "tags": [
          "URLs"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "List of all short URLs",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/ShortUrl"
                  }
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Unauthorized"
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Admin access required"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/api/urls/{id}": {
      "delete": {
        "summary": "Delete a URL (admin only)",
        "tags": [
          "URLs"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "integer"
            }
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "URL deleted"
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Unauthorized"
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Admin access required"
          },
          "404": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "URL not found"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/admin/users": {
      "get": {
        "summary": "List all users (admin only)",
        "tags": [
          "Admin"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "List of all users",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/User"
                  }
                }
              }
            }
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Unauthorized"
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Admin access required"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
    "/admin/users/{id}/role": {
      "patch": {
        "summary": "Update a user's role (admin only)",
        "tags": [
          "Admin"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "integer"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "enum": [
                      "user",
                      "privileged"
                    ]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Updated user object",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/User"
                }
              }
            }
          },
          "400": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Validation error"
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Unauthorized"
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Admin access required"
          },
          "404": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "User not found"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    },
        "/admin/urls": {
      "get": {
        "summary": "List all short URLs (admin)",
        "tags": [
          "Admin"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Array of all short URL records"
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Not authenticated"
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Forbidden — admin only"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }
        }
      }
    },
    "/admin/urls/{id}": {
      "delete": {
        "summary": "Delete any URL (admin only)",
        "tags": [
          "Admin"
        ],
        "security": [
          {
            "sessionCookie": []
          },
          {
            "BearerAuth": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "integer"
            }
          }
        ],
        "responses": {
          "200": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "URL deleted"
          },
          "401": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Unauthorized"
          },
          "403": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "Admin access required"
          },
          "404": {
            "headers": {
              "RateLimit": {
                "$ref": "#/components/headers/RateLimit"
              },
              "RateLimit-Policy": {
                "$ref": "#/components/headers/RateLimit-Policy"
              }
            },
            "description": "URL not found"
          },
          "429": {
            "$ref": "#/components/responses/TooManyRequests"
          }

        }
      }
    }
  }
};

export default spec;
