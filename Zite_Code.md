### C:\dev\Hockey Trials App\Squad-Selection\.env.local

# Supabase
VITE_SUPABASE_URL=https://astnstiieejqtrnmxhml.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_WGk4vU-rh1HIO711CkFfDg_f0lKXX2k

# Airtable – ⚠️ SECURITY WARNING: These keys will be exposed in the client bundle.
# They are needed for local development, but for production you MUST move these calls to a backend.
VITE_AIRTABLE_TOKEN=patQygrmNRXXXX
VITE_AIRTABLE_BASE_ID=appG6amyHthm3Nnde

### C:\dev\Hockey Trials App\Squad-Selection\.gitignore

node_modules

### C:\dev\Hockey Trials App\Squad-Selection\index.html

<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />
  <title>HKFC Squad Selection</title>
</head>

<body>
  <div id="root"></div>

  <script
    type="module"
    src="/src/main.tsx"
  ></script>
</body>
</html>

### C:\dev\Hockey Trials App\Squad-Selection\package-lock.json

{
  "name": "hkfc-squad-selection",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "hkfc-squad-selection",
      "version": "1.0.0",
      "dependencies": {
        "@supabase/ssr": "^0.12.0",
        "@supabase/supabase-js": "^2.110.0",
        "airtable": "^0.12",
        "date-fns": "^4",
        "lucide-react": "latest",
        "react": "^19",
        "react-dom": "^19",
        "react-router-dom": "^7",
        "sonner": "^2.0.7",
        "zod": "^4"
      },
      "devDependencies": {
        "@tailwindcss/postcss": "^4.3.2",
        "@types/node": "^26.1.0",
        "@types/react": "^19",
        "@types/react-dom": "^19",
        "@vitejs/plugin-react": "^5",
        "autoprefixer": "^10.5.2",
        "tailwindcss": "^4",
        "tailwindcss-animate": "^1.0.7",
        "typescript": "^5",
        "vite": "^7",
        "wrangler": "^4"
      }
    },
    "node_modules/@alloc/quick-lru": {
      "version": "5.2.0",
      "resolved": "https://registry.npmjs.org/@alloc/quick-lru/-/quick-lru-5.2.0.tgz",
      "integrity": "sha512-UrcABB+4bUrFABwbluTIBErXwvbsU/V7TZWfmbgJfbkwiBuziS9gxdODUyuiecfdGQ85jglMW6juS3+z5TsKLw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/@babel/code-frame": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/code-frame/-/code-frame-7.29.7.tgz",
      "integrity": "sha512-Aup7aUOfpbAUg2ROOJN6Iw5f9DMBlzu0mIkm/malLQFN/YQgO48wCj0Kxa3sEHJvPVFg7siR+qRInwXd2qhQKw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-validator-identifier": "^7.29.7",
        "js-tokens": "^4.0.0",
        "picocolors": "^1.1.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/compat-data": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/compat-data/-/compat-data-7.29.7.tgz",
      "integrity": "sha512-locTkQyKvwIEgBzVrn8693ebc97F2U8ZHjbXwDXJ5Fn2TCpNwTlKcaKLkdHop5c/icOFE7qt7Q9JC5hnKNa6Gg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/core": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/core/-/core-7.29.7.tgz",
      "integrity": "sha512-RgHBCvtjbOK2gXSNBNIkNoEc9qoVEtau3hj8gEqKQuL3HZAibKarWFEI3Lfm6EYKkLalOh8eSrj9b+ch9H/VBA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.29.7",
        "@babel/generator": "^7.29.7",
        "@babel/helper-compilation-targets": "^7.29.7",
        "@babel/helper-module-transforms": "^7.29.7",
        "@babel/helpers": "^7.29.7",
        "@babel/parser": "^7.29.7",
        "@babel/template": "^7.29.7",
        "@babel/traverse": "^7.29.7",
        "@babel/types": "^7.29.7",
        "@jridgewell/remapping": "^2.3.5",
        "convert-source-map": "^2.0.0",
        "debug": "^4.1.0",
        "gensync": "^1.0.0-beta.2",
        "json5": "^2.2.3",
        "semver": "^6.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/babel"
      }
    },
    "node_modules/@babel/generator": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/generator/-/generator-7.29.7.tgz",
      "integrity": "sha512-DkXD5OJQaAQIdZ1bt3UZdEnHAn9Imd3IVBdX03UFe+ony9Ojw5pzr9YVKGDY1jt+Gcn/FnGkNf8r+Vj5NOJWtQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.29.7",
        "@babel/types": "^7.29.7",
        "@jridgewell/gen-mapping": "^0.3.12",
        "@jridgewell/trace-mapping": "^0.3.28",
        "jsesc": "^3.0.2"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-compilation-targets": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-compilation-targets/-/helper-compilation-targets-7.29.7.tgz",
      "integrity": "sha512-wem6WaBj4NaVYVdNhLPPVacES6ZJ+KBBfSkTMD3YZxbP3rm3Di85tJU5ljaUNhaOynt+Aj0xruhYuzQBt8n71g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/compat-data": "^7.29.7",
        "@babel/helper-validator-option": "^7.29.7",
        "browserslist": "^4.24.0",
        "lru-cache": "^5.1.1",
        "semver": "^6.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-globals": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-globals/-/helper-globals-7.29.7.tgz",
      "integrity": "sha512-3nQVUAtvkKH9zahfWgw96Jc/uFOmjACE1kQz82E2lqWmHBgjzbNlsC22nuQTfahmWeQtTq5nQ/4Nnd2A1wj4zA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-module-imports": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-module-imports/-/helper-module-imports-7.29.7.tgz",
      "integrity": "sha512-ejHwrQQYcm9xnTivShn2IDOlIzInN34AXskvq9QicvCtEzq1Vzclu/tKF8Jq1Cg8JG2GL6/EmjgsCT7lXepE3g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/traverse": "^7.29.7",
        "@babel/types": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-module-transforms": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-module-transforms/-/helper-module-transforms-7.29.7.tgz",
      "integrity": "sha512-UPUVSyXbOh627KiCIGQSgwWzGeBKLkaJ9PJEdrngIwMSzxLR4jS4+f1f1jb7VzBbg8nFLaYotvVPFCTqdrmTAg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-module-imports": "^7.29.7",
        "@babel/helper-validator-identifier": "^7.29.7",
        "@babel/traverse": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0"
      }
    },
    "node_modules/@babel/helper-plugin-utils": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-plugin-utils/-/helper-plugin-utils-7.29.7.tgz",
      "integrity": "sha512-G7sHYigPY17oO5SYWnfD/0MTBwVR781S/JI643e/JhUYgVgWE/61SoW3NH9KWUKyKq5LVh3npif99Wkt6j86Jw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-string-parser": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-string-parser/-/helper-string-parser-7.29.7.tgz",
      "integrity": "sha512-Pb5ijPrZ89GDH8223L4UP8i6QApWxs04RbPQJTeWDV0/keR2E36MeKnyr6LYmUUvqRRI+Iv87SuF1W6ErINzYw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-validator-identifier": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-validator-identifier/-/helper-validator-identifier-7.29.7.tgz",
      "integrity": "sha512-qehxGkRj55h/ff8EMaJ+cYhyaKlHIxqYDn682wQD7RNp9UujOQsHog2uS0r2vzr4pW+sXf90NeeayjcNaX3fFg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-validator-option": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-validator-option/-/helper-validator-option-7.29.7.tgz",
      "integrity": "sha512-N9ZErrD+yW5geCDtBqnOoxmR8+tNKiGuxKlDpuJxfsqpa2dFcexaziGAE/qoHLiDDreVNMupxGmSoNlyvsA3gw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helpers": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helpers/-/helpers-7.29.7.tgz",
      "integrity": "sha512-1k2lAGRMfHTcwuNYcCNUmaUffmQv8KWMfh2iJUUeRlwlwH4FdNG7mfPI10NPfLHJFThE4Tyr4mv7kTNZOiPuBg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/template": "^7.29.7",
        "@babel/types": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/parser": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/parser/-/parser-7.29.7.tgz",
      "integrity": "sha512-hnORnjP/1P/zFEndoeX+n+t1RwWRJiJpM/jO7FW32Kn9r5+sJB2JWOdYo4L6k78j15eCwY3Gm/7364B1EMwtNg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.29.7"
      },
      "bin": {
        "parser": "bin/babel-parser.js"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@babel/plugin-transform-react-jsx-self": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/plugin-transform-react-jsx-self/-/plugin-transform-react-jsx-self-7.29.7.tgz",
      "integrity": "sha512-TL0hMc9xzy86VD31nUiwzd5otRAcyEPcsegCxolO0PvcXuH1v0kECe/UIznYFihpkvU5wg/jk4v0TTEFfm53fw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-transform-react-jsx-source": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/plugin-transform-react-jsx-source/-/plugin-transform-react-jsx-source-7.29.7.tgz",
      "integrity": "sha512-06IyK09H3wi4cGbhDBwp5gUGo0IKtnYa8tyTiephirPCK6fbobVGiXMMI5zLQ4aKEYP3wZ3ArU44o+8KMrSG/Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/template": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/template/-/template-7.29.7.tgz",
      "integrity": "sha512-puq+Gf35oI24FeN11LkoUQFqv9uwNeWpxXZi/Ji3rRIoKAzKnxRaZ+Gkj0vKS9ZCiTESfng1N9LyOyXvo+m+Gg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.29.7",
        "@babel/parser": "^7.29.7",
        "@babel/types": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/traverse": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/traverse/-/traverse-7.29.7.tgz",
      "integrity": "sha512-EhlfNQtZ+NK22w5BM61ciuiq1m58ed33Wr1Xan//ZRTy6hgjnwyCffRYwzsGXdASJSUJ1guZILsErh1eQcl+zw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.29.7",
        "@babel/generator": "^7.29.7",
        "@babel/helper-globals": "^7.29.7",
        "@babel/parser": "^7.29.7",
        "@babel/template": "^7.29.7",
        "@babel/types": "^7.29.7",
        "debug": "^4.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/types": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/types/-/types-7.29.7.tgz",
      "integrity": "sha512-4zBIxpPzowiZpusoFkyGVwakdRJUyuH5PxQ/PrqghfdFWWasvnCdPfQXHrenDai+gyLARulZjZowCOj6fjT4pA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-string-parser": "^7.29.7",
        "@babel/helper-validator-identifier": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@cloudflare/kv-asset-handler": {
      "version": "0.5.0",
      "resolved": "https://registry.npmjs.org/@cloudflare/kv-asset-handler/-/kv-asset-handler-0.5.0.tgz",
      "integrity": "sha512-jxQYkj8dSIzc0cD6cMMNdOc1UVjqSqu8BZdor5s8cGjW2I8BjODt/kWPVdY+u9zj3ms75Q5qaZgnxUad83+eAg==",
      "dev": true,
      "license": "MIT OR Apache-2.0",
      "engines": {
        "node": ">=22.0.0"
      }
    },
    "node_modules/@cloudflare/unenv-preset": {
      "version": "2.16.1",
      "resolved": "https://registry.npmjs.org/@cloudflare/unenv-preset/-/unenv-preset-2.16.1.tgz",
      "integrity": "sha512-ECxObrMfyTl5bhQf/lZCXwo5G6xX9IAUo+nDMKK4SZ8m4Jvvxp52vilxyySSWh2YTZz8+HQ07qGH/2rEom1vDw==",
      "dev": true,
      "license": "MIT OR Apache-2.0",
      "peerDependencies": {
        "unenv": "2.0.0-rc.24",
        "workerd": ">1.20260305.0 <2.0.0-0"
      },
      "peerDependenciesMeta": {
        "workerd": {
          "optional": true
        }
      }
    },
    "node_modules/@cloudflare/workerd-darwin-64": {
      "version": "1.20260630.1",
      "resolved": "https://registry.npmjs.org/@cloudflare/workerd-darwin-64/-/workerd-darwin-64-1.20260630.1.tgz",
      "integrity": "sha512-oEVsD2NZtPAMaEvFeH2Y6N63yiFuOnPDKeAM+l8AkRbLAbFk462uWOq6/ZLn8ouY4P4coMkgsOPqcT1mkuzvzg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=16"
      }
    },
    "node_modules/@cloudflare/workerd-darwin-arm64": {
      "version": "1.20260630.1",
      "resolved": "https://registry.npmjs.org/@cloudflare/workerd-darwin-arm64/-/workerd-darwin-arm64-1.20260630.1.tgz",
      "integrity": "sha512-tar1vcQSzM+27Agrlv28BhtN1tIFKw2YHrzldEMyQJOJB/885TU8Z3oO1c/a9YOmsKABhD6I4dGFhsmXyrbK1g==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=16"
      }
    },
    "node_modules/@cloudflare/workerd-linux-64": {
      "version": "1.20260630.1",
      "resolved": "https://registry.npmjs.org/@cloudflare/workerd-linux-64/-/workerd-linux-64-1.20260630.1.tgz",
      "integrity": "sha512-mhjIg91+ikWw5v9tY4BYO7N9vLOZBhn7EnVFvxCdxcpuUUFBKATxUYHUy1kkgYxnmiI6s93PRNbzBz1NpYQ3IQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=16"
      }
    },
    "node_modules/@cloudflare/workerd-linux-arm64": {
      "version": "1.20260630.1",
      "resolved": "https://registry.npmjs.org/@cloudflare/workerd-linux-arm64/-/workerd-linux-arm64-1.20260630.1.tgz",
      "integrity": "sha512-7g0iGvMCwGct+vE3FOKXtFWMAIGHzK2Ei9oALp44gXuL4lBcs3PPJISeTp5itquW2JwS1fw4Hnq7zrT7N/dgPw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=16"
      }
    },
    "node_modules/@cloudflare/workerd-windows-64": {
      "version": "1.20260630.1",
      "resolved": "https://registry.npmjs.org/@cloudflare/workerd-windows-64/-/workerd-windows-64-1.20260630.1.tgz",
      "integrity": "sha512-J5KF9VF8yRpRBib/cPSuEp6iR9q3/cKgeDVhg1ZtuwpkzwnmCb+rxMF5WFLxAN8bI2x2FMG1v6o4vVFOGZ0fOQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=16"
      }
    },
    "node_modules/@cspotcode/source-map-support": {
      "version": "0.8.1",
      "resolved": "https://registry.npmjs.org/@cspotcode/source-map-support/-/source-map-support-0.8.1.tgz",
      "integrity": "sha512-IchNf6dN4tHoMFIn/7OE8LWZ19Y6q/67Bmf6vnGREv8RSbBVb9LPJxEcnwrcwX6ixSvaiGoomAUvu4YSxXrVgw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/trace-mapping": "0.3.9"
      },
      "engines": {
        "node": ">=12"
      }
    },
    "node_modules/@cspotcode/source-map-support/node_modules/@jridgewell/trace-mapping": {
      "version": "0.3.9",
      "resolved": "https://registry.npmjs.org/@jridgewell/trace-mapping/-/trace-mapping-0.3.9.tgz",
      "integrity": "sha512-3Belt6tdc8bPgAtbcmdtNJlirVoTmEb5e2gC94PnkwEW9jI6CAHUeoG85tjWP5WquqfavoMtMwiG4P926ZKKuQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/resolve-uri": "^3.0.3",
        "@jridgewell/sourcemap-codec": "^1.4.10"
      }
    },
    "node_modules/@emnapi/runtime": {
      "version": "1.11.1",
      "resolved": "https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.11.1.tgz",
      "integrity": "sha512-vgj7R3y3Wgx24IQaGPA/R6YFXLHVMOZ0uVEyIQPaWs+rd1AzfEMXlAC22FYwO1XkKR6NPsq7mUandH8oIRdZFw==",
      "dev": true,
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "tslib": "^2.4.0"
      }
    },
    "node_modules/@esbuild/aix-ppc64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.28.1.tgz",
      "integrity": "sha512-Svl7tq8k/08+p6CXPpRjQ1fKX+1odH/BQbb48fV6fj3CWHhsoIOoY87w1oHXm0qEpkIK3ZfVgp0hed3XBXzXMQ==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "aix"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-arm": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/android-arm/-/android-arm-0.28.1.tgz",
      "integrity": "sha512-0k2F129Xdio1TdJfzJ8sy1Q47vUD2NnwdhiAf7drUN1EBTfPf4hsFCtmMgu/6m8JSzsBrlmVjudMBQqOfG8usQ==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-arm64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/android-arm64/-/android-arm64-0.28.1.tgz",
      "integrity": "sha512-34EGEbCIAgosYz6goLcopX6Mo7NyGv9tfwEM2/7Ce2VcVRk568iSvniGWcUXIy7wEDR1wzolcxcriFVrWYcwBg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-x64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/android-x64/-/android-x64-0.28.1.tgz",
      "integrity": "sha512-dbwY7ltSMDWsRatcRpCnES4F+im88OCUgGZjy52shC7GqHRE/cYlxNbB4Z4UpJswpcc4Qxd2oE/ufM0p61IKng==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/darwin-arm64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.28.1.tgz",
      "integrity": "sha512-TZbWkQY7kvTAXbXUT7uVACR5cMHsDiSz9z7ZKAX/RTq/WJEk3QyRr0wZpNhBDX+/0CtdqUIJlOiodQcta6tY3Q==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/darwin-x64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/darwin-x64/-/darwin-x64-0.28.1.tgz",
      "integrity": "sha512-zfdzgK9ACBNZLI/CyHTOx81SyNbM6YXn7rxSgX97VjyiPl9W1i4Ka4fgKECEoFCKGpvBj5qArWIGgQjOwkgskQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/freebsd-arm64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-arm64/-/freebsd-arm64-0.28.1.tgz",
      "integrity": "sha512-wG2EA8ENdEI0qhkSZMjfqrdY+ziCYCPMmtZjjIwOmXFjmyzEHn+UUxk5of+SYsjtfs3VpnlC7QLzSI5hY/rOAw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/freebsd-x64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-x64/-/freebsd-x64-0.28.1.tgz",
      "integrity": "sha512-i7dZ9vQgnvSCzi/rYCXNgtF/U+eKZNJBzu3eTQbRgHnM7tNSizLOkRFAl3qzVc/Op/u5YkHHa4pf/3DOYHthLQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-arm": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm/-/linux-arm-0.28.1.tgz",
      "integrity": "sha512-qVXBOHQS+d5Y722GwJzJUtOLlX7km3CraOaGormF1pDtPd2C/l1SHRPgjLunLGe51Sh5YYWKMFDyV4SxgMQYTQ==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-arm64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.28.1.tgz",
      "integrity": "sha512-yHs+0uc8+nvEAfAfxrWQKK5peSNzBc4PegcMO0EJ2hT71uA7vB8Ihg2e77R2P7SG5uYjPbHlLLmve4LLLRCf0g==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-ia32": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-ia32/-/linux-ia32-0.28.1.tgz",
      "integrity": "sha512-d1z4ZuP0ajrfz/FhGT4vv278rX8KnPPJx8i5+AtK7TYbx9Le9F1hyzurZpkEyjkGa9dUGhQow4C1NmeGvqxN2w==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-loong64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-loong64/-/linux-loong64-0.28.1.tgz",
      "integrity": "sha512-M5sRjUVZrkm1OAPR3dlOYzNmN+loZKGVi1VUQGrwuqLcbR6qeAz+famMhjASeH3YVKvZz+zT1jlh/keC3Rj/lg==",
      "cpu": [
        "loong64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-mips64el": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-mips64el/-/linux-mips64el-0.28.1.tgz",
      "integrity": "sha512-mRObBZeHh2OxcBFPWE/FjylkRgZdYuiTR3vaTozquCGOH14iP9oN4x4Ge81CoIDYQrXmIxpFumJBu5MtZpnQJQ==",
      "cpu": [
        "mips64el"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-ppc64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-ppc64/-/linux-ppc64-0.28.1.tgz",
      "integrity": "sha512-slScBsMAb3GFDcdrCgLwZtPYRoH2H/youv10QiZyRjmsP48fznoveWytSgCI/R0ZcUgpc0ZhIUEx6LHts8yrfQ==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-riscv64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-riscv64/-/linux-riscv64-0.28.1.tgz",
      "integrity": "sha512-kw0owk1o0GFETUJyW0jc0G4Yzs0BHZn0JDZ8JRT088vjJYX777BAs1fDGxAC+q831qOs2DTC96mNsG2opdfyyQ==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-s390x": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-s390x/-/linux-s390x-0.28.1.tgz",
      "integrity": "sha512-/lAIjX8aYFRByhh6L5rYtPEDRqa9de/4V/juOXcta5frjvzXO4/sqEtyytse0g3zZFuWu5cDN0MkLz2qRDD2Ag==",
      "cpu": [
        "s390x"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-x64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.28.1.tgz",
      "integrity": "sha512-u/anNYF2mmVOEDwLtnQ1wOr3EZ9sTNGLWrsYGYwHWzGA3Si84IOkHXlbWTD1NB+9/1lcnweYKO54uhxZydNzfA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/netbsd-arm64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-arm64/-/netbsd-arm64-0.28.1.tgz",
      "integrity": "sha512-oks0DYbLwWMmaakTsCb+zL4E+aHRVLom9IJZOAthMQEPiQmydXHkziYEsGYRx0uNV/IjEKGAV941JzH02pflqw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "netbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/netbsd-x64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-x64/-/netbsd-x64-0.28.1.tgz",
      "integrity": "sha512-aeL6lAnN89Hz43Mlh1G8ARasbuoYvSITDEx0tHh5b7jJnHcssqgjy9Yx430GDpmCa6OyrKoS0aNRjKundRizGg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "netbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openbsd-arm64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-arm64/-/openbsd-arm64-0.28.1.tgz",
      "integrity": "sha512-MEFJe5C3R8pwXdZ5Y21oo6m7ePiS0d9pWucn99O/wvyJZChoIQKrQDxKrGeW8F5+T0okTHesAmDeiHDTIq0V/Q==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openbsd-x64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-x64/-/openbsd-x64-0.28.1.tgz",
      "integrity": "sha512-i/ZLIOafE0Z8cI/XANJAixoJL/uRAoS2xOA3rb0xN+KK0K177cMAsQYkzHtBrtMXAKuAc7HGgcWiZ/sRC1Nxgw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openharmony-arm64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/openharmony-arm64/-/openharmony-arm64-0.28.1.tgz",
      "integrity": "sha512-ge+Z7EXFNt2BO1oAMsVpiQ8EwndV9i1xXerAeTIK7AtPs3bKFXQM7nlRxDSIUIMeueR1CNXxqztLzdNeReKBJg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openharmony"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/sunos-x64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/sunos-x64/-/sunos-x64-0.28.1.tgz",
      "integrity": "sha512-BEjgtECkL3vY+SaSQ6nzVfiALUeFxpawyp8Jmf5PtYhf1Ug40N1h/hxlhts+f1FvSvarEigdxS3BlSMI2PJLcQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "sunos"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-arm64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-arm64/-/win32-arm64-0.28.1.tgz",
      "integrity": "sha512-lCv9eK/H6ZJWbE7bh2nw54CZ9M2nupBxJcTsdk/QQnWkdSjKGuxmmH8/GWrlT1eMmZfn4dGcCjRte397WqfQXA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-ia32": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-ia32/-/win32-ia32-0.28.1.tgz",
      "integrity": "sha512-zvb/mB2bSCoJOpoCBgYKKpX6YM6mJBlBUVUtVj41DlZJVEB6/0CKlRYxP5wWl1C1ILiCoAU5wZZ4q1P3qeS6Eg==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-x64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.28.1.tgz",
      "integrity": "sha512-bm4Mowrv+GXMlpWX++EcXw/iLyd1o3+bJkC2DkWXYVvgZCqD/bSj9ctZeAMC3cIxgjRVR2Dufaiu4YPxr5gW1A==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@img/colour": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/@img/colour/-/colour-1.1.0.tgz",
      "integrity": "sha512-Td76q7j57o/tLVdgS746cYARfSyxk8iEfRxewL9h4OMzYhbW4TAcppl0mT4eyqXddh6L/jwoM75mo7ixa/pCeQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@img/sharp-darwin-arm64": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-darwin-arm64/-/sharp-darwin-arm64-0.34.5.tgz",
      "integrity": "sha512-imtQ3WMJXbMY4fxb/Ndp6HBTNVtWCUI0WdobyheGf5+ad6xX8VIDO8u2xE4qc/fr08CKG/7dDseFtn6M6g/r3w==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-libvips-darwin-arm64": "1.2.4"
      }
    },
    "node_modules/@img/sharp-darwin-x64": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-darwin-x64/-/sharp-darwin-x64-0.34.5.tgz",
      "integrity": "sha512-YNEFAF/4KQ/PeW0N+r+aVVsoIY0/qxxikF2SWdp+NRkmMB7y9LBZAVqQ4yhGCm/H3H270OSykqmQMKLBhBJDEw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-libvips-darwin-x64": "1.2.4"
      }
    },
    "node_modules/@img/sharp-libvips-darwin-arm64": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@img/sharp-libvips-darwin-arm64/-/sharp-libvips-darwin-arm64-1.2.4.tgz",
      "integrity": "sha512-zqjjo7RatFfFoP0MkQ51jfuFZBnVE2pRiaydKJ1G/rHZvnsrHAOcQALIi9sA5co5xenQdTugCvtb1cuf78Vf4g==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "darwin"
      ],
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-libvips-darwin-x64": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@img/sharp-libvips-darwin-x64/-/sharp-libvips-darwin-x64-1.2.4.tgz",
      "integrity": "sha512-1IOd5xfVhlGwX+zXv2N93k0yMONvUlANylbJw1eTah8K/Jtpi15KC+WSiaX/nBmbm2HxRM1gZ0nSdjSsrZbGKg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "darwin"
      ],
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-libvips-linux-arm": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@img/sharp-libvips-linux-arm/-/sharp-libvips-linux-arm-1.2.4.tgz",
      "integrity": "sha512-bFI7xcKFELdiNCVov8e44Ia4u2byA+l3XtsAj+Q8tfCwO6BQ8iDojYdvoPMqsKDkuoOo+X6HZA0s0q11ANMQ8A==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "linux"
      ],
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-libvips-linux-arm64": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@img/sharp-libvips-linux-arm64/-/sharp-libvips-linux-arm64-1.2.4.tgz",
      "integrity": "sha512-excjX8DfsIcJ10x1Kzr4RcWe1edC9PquDRRPx3YVCvQv+U5p7Yin2s32ftzikXojb1PIFc/9Mt28/y+iRklkrw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "linux"
      ],
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-libvips-linux-ppc64": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@img/sharp-libvips-linux-ppc64/-/sharp-libvips-linux-ppc64-1.2.4.tgz",
      "integrity": "sha512-FMuvGijLDYG6lW+b/UvyilUWu5Ayu+3r2d1S8notiGCIyYU/76eig1UfMmkZ7vwgOrzKzlQbFSuQfgm7GYUPpA==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "linux"
      ],
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-libvips-linux-riscv64": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@img/sharp-libvips-linux-riscv64/-/sharp-libvips-linux-riscv64-1.2.4.tgz",
      "integrity": "sha512-oVDbcR4zUC0ce82teubSm+x6ETixtKZBh/qbREIOcI3cULzDyb18Sr/Wcyx7NRQeQzOiHTNbZFF1UwPS2scyGA==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "linux"
      ],
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-libvips-linux-s390x": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@img/sharp-libvips-linux-s390x/-/sharp-libvips-linux-s390x-1.2.4.tgz",
      "integrity": "sha512-qmp9VrzgPgMoGZyPvrQHqk02uyjA0/QrTO26Tqk6l4ZV0MPWIW6LTkqOIov+J1yEu7MbFQaDpwdwJKhbJvuRxQ==",
      "cpu": [
        "s390x"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "linux"
      ],
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-libvips-linux-x64": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@img/sharp-libvips-linux-x64/-/sharp-libvips-linux-x64-1.2.4.tgz",
      "integrity": "sha512-tJxiiLsmHc9Ax1bz3oaOYBURTXGIRDODBqhveVHonrHJ9/+k89qbLl0bcJns+e4t4rvaNBxaEZsFtSfAdquPrw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "linux"
      ],
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-libvips-linuxmusl-arm64": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@img/sharp-libvips-linuxmusl-arm64/-/sharp-libvips-linuxmusl-arm64-1.2.4.tgz",
      "integrity": "sha512-FVQHuwx1IIuNow9QAbYUzJ+En8KcVm9Lk5+uGUQJHaZmMECZmOlix9HnH7n1TRkXMS0pGxIJokIVB9SuqZGGXw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "linux"
      ],
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-libvips-linuxmusl-x64": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@img/sharp-libvips-linuxmusl-x64/-/sharp-libvips-linuxmusl-x64-1.2.4.tgz",
      "integrity": "sha512-+LpyBk7L44ZIXwz/VYfglaX/okxezESc6UxDSoyo2Ks6Jxc4Y7sGjpgU9s4PMgqgjj1gZCylTieNamqA1MF7Dg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "linux"
      ],
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-linux-arm": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-linux-arm/-/sharp-linux-arm-0.34.5.tgz",
      "integrity": "sha512-9dLqsvwtg1uuXBGZKsxem9595+ujv0sJ6Vi8wcTANSFpwV/GONat5eCkzQo/1O6zRIkh0m/8+5BjrRr7jDUSZw==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-libvips-linux-arm": "1.2.4"
      }
    },
    "node_modules/@img/sharp-linux-arm64": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-linux-arm64/-/sharp-linux-arm64-0.34.5.tgz",
      "integrity": "sha512-bKQzaJRY/bkPOXyKx5EVup7qkaojECG6NLYswgktOZjaXecSAeCWiZwwiFf3/Y+O1HrauiE3FVsGxFg8c24rZg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-libvips-linux-arm64": "1.2.4"
      }
    },
    "node_modules/@img/sharp-linux-ppc64": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-linux-ppc64/-/sharp-linux-ppc64-0.34.5.tgz",
      "integrity": "sha512-7zznwNaqW6YtsfrGGDA6BRkISKAAE1Jo0QdpNYXNMHu2+0dTrPflTLNkpc8l7MUP5M16ZJcUvysVWWrMefZquA==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-libvips-linux-ppc64": "1.2.4"
      }
    },
    "node_modules/@img/sharp-linux-riscv64": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-linux-riscv64/-/sharp-linux-riscv64-0.34.5.tgz",
      "integrity": "sha512-51gJuLPTKa7piYPaVs8GmByo7/U7/7TZOq+cnXJIHZKavIRHAP77e3N2HEl3dgiqdD/w0yUfiJnII77PuDDFdw==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-libvips-linux-riscv64": "1.2.4"
      }
    },
    "node_modules/@img/sharp-linux-s390x": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-linux-s390x/-/sharp-linux-s390x-0.34.5.tgz",
      "integrity": "sha512-nQtCk0PdKfho3eC5MrbQoigJ2gd1CgddUMkabUj+rBevs8tZ2cULOx46E7oyX+04WGfABgIwmMC0VqieTiR4jg==",
      "cpu": [
        "s390x"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-libvips-linux-s390x": "1.2.4"
      }
    },
    "node_modules/@img/sharp-linux-x64": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-linux-x64/-/sharp-linux-x64-0.34.5.tgz",
      "integrity": "sha512-MEzd8HPKxVxVenwAa+JRPwEC7QFjoPWuS5NZnBt6B3pu7EG2Ge0id1oLHZpPJdn3OQK+BQDiw9zStiHBTJQQQQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-libvips-linux-x64": "1.2.4"
      }
    },
    "node_modules/@img/sharp-linuxmusl-arm64": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-linuxmusl-arm64/-/sharp-linuxmusl-arm64-0.34.5.tgz",
      "integrity": "sha512-fprJR6GtRsMt6Kyfq44IsChVZeGN97gTD331weR1ex1c1rypDEABN6Tm2xa1wE6lYb5DdEnk03NZPqA7Id21yg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-libvips-linuxmusl-arm64": "1.2.4"
      }
    },
    "node_modules/@img/sharp-linuxmusl-x64": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-linuxmusl-x64/-/sharp-linuxmusl-x64-0.34.5.tgz",
      "integrity": "sha512-Jg8wNT1MUzIvhBFxViqrEhWDGzqymo3sV7z7ZsaWbZNDLXRJZoRGrjulp60YYtV4wfY8VIKcWidjojlLcWrd8Q==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "Apache-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-libvips-linuxmusl-x64": "1.2.4"
      }
    },
    "node_modules/@img/sharp-wasm32": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-wasm32/-/sharp-wasm32-0.34.5.tgz",
      "integrity": "sha512-OdWTEiVkY2PHwqkbBI8frFxQQFekHaSSkUIJkwzclWZe64O1X4UlUjqqqLaPbUpMOQk6FBu/HtlGXNblIs0huw==",
      "cpu": [
        "wasm32"
      ],
      "dev": true,
      "license": "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
      "optional": true,
      "dependencies": {
        "@emnapi/runtime": "^1.7.0"
      },
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-win32-arm64": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-win32-arm64/-/sharp-win32-arm64-0.34.5.tgz",
      "integrity": "sha512-WQ3AgWCWYSb2yt+IG8mnC6Jdk9Whs7O0gxphblsLvdhSpSTtmu69ZG1Gkb6NuvxsNACwiPV6cNSZNzt0KPsw7g==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "Apache-2.0 AND LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-win32-ia32": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-win32-ia32/-/sharp-win32-ia32-0.34.5.tgz",
      "integrity": "sha512-FV9m/7NmeCmSHDD5j4+4pNI8Cp3aW+JvLoXcTUo0IqyjSfAZJ8dIUmijx1qaJsIiU+Hosw6xM5KijAWRJCSgNg==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "Apache-2.0 AND LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@img/sharp-win32-x64": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/@img/sharp-win32-x64/-/sharp-win32-x64-0.34.5.tgz",
      "integrity": "sha512-+29YMsqY2/9eFEiW93eqWnuLcWcufowXewwSNIT6UwZdUUCrM3oFjMWH/Z6/TMmb4hlFenmfAVbpWeup2jryCw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "Apache-2.0 AND LGPL-3.0-or-later",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      }
    },
    "node_modules/@jridgewell/gen-mapping": {
      "version": "0.3.13",
      "resolved": "https://registry.npmjs.org/@jridgewell/gen-mapping/-/gen-mapping-0.3.13.tgz",
      "integrity": "sha512-2kkt/7niJ6MgEPxF0bYdQ6etZaA+fQvDcLKckhy1yIQOzaoKjBBjSj63/aLVjYE3qhRt5dvM+uUyfCg6UKCBbA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/sourcemap-codec": "^1.5.0",
        "@jridgewell/trace-mapping": "^0.3.24"
      }
    },
    "node_modules/@jridgewell/remapping": {
      "version": "2.3.5",
      "resolved": "https://registry.npmjs.org/@jridgewell/remapping/-/remapping-2.3.5.tgz",
      "integrity": "sha512-LI9u/+laYG4Ds1TDKSJW2YPrIlcVYOwi2fUC6xB43lueCjgxV4lffOCZCtYFiH6TNOX+tQKXx97T4IKHbhyHEQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/gen-mapping": "^0.3.5",
        "@jridgewell/trace-mapping": "^0.3.24"
      }
    },
    "node_modules/@jridgewell/resolve-uri": {
      "version": "3.1.2",
      "resolved": "https://registry.npmjs.org/@jridgewell/resolve-uri/-/resolve-uri-3.1.2.tgz",
      "integrity": "sha512-bRISgCIjP20/tbWSPWMEi54QVPRZExkuD9lJL+UIxUKtwVJA8wW1Trb1jMs1RFXo1CBTNZ/5hpC9QvmKWdopKw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@jridgewell/sourcemap-codec": {
      "version": "1.5.5",
      "resolved": "https://registry.npmjs.org/@jridgewell/sourcemap-codec/-/sourcemap-codec-1.5.5.tgz",
      "integrity": "sha512-cYQ9310grqxueWbl+WuIUIaiUaDcj7WOq5fVhEljNVgRfOUhY9fy2zTvfoqWsnebh8Sl70VScFbICvJnLKB0Og==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@jridgewell/trace-mapping": {
      "version": "0.3.31",
      "resolved": "https://registry.npmjs.org/@jridgewell/trace-mapping/-/trace-mapping-0.3.31.tgz",
      "integrity": "sha512-zzNR+SdQSDJzc8joaeP8QQoCQr8NuYx2dIIytl1QeBEZHJ9uW6hebsrYgbz8hJwUQao3TWCMtmfV8Nu1twOLAw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/resolve-uri": "^3.1.0",
        "@jridgewell/sourcemap-codec": "^1.4.14"
      }
    },
    "node_modules/@poppinss/colors": {
      "version": "4.1.6",
      "resolved": "https://registry.npmjs.org/@poppinss/colors/-/colors-4.1.6.tgz",
      "integrity": "sha512-H9xkIdFswbS8n1d6vmRd8+c10t2Qe+rZITbbDHHkQixH5+2x1FDGmi/0K+WgWiqQFKPSlIYB7jlH6Kpfn6Fleg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "kleur": "^4.1.5"
      }
    },
    "node_modules/@poppinss/dumper": {
      "version": "0.6.5",
      "resolved": "https://registry.npmjs.org/@poppinss/dumper/-/dumper-0.6.5.tgz",
      "integrity": "sha512-NBdYIb90J7LfOI32dOewKI1r7wnkiH6m920puQ3qHUeZkxNkQiFnXVWoE6YtFSv6QOiPPf7ys6i+HWWecDz7sw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@poppinss/colors": "^4.1.5",
        "@sindresorhus/is": "^7.0.2",
        "supports-color": "^10.0.0"
      }
    },
    "node_modules/@poppinss/exception": {
      "version": "1.2.3",
      "resolved": "https://registry.npmjs.org/@poppinss/exception/-/exception-1.2.3.tgz",
      "integrity": "sha512-dCED+QRChTVatE9ibtoaxc+WkdzOSjYTKi/+uacHWIsfodVfpsueo3+DKpgU5Px8qXjgmXkSvhXvSCz3fnP9lw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@rolldown/pluginutils": {
      "version": "1.0.0-rc.3",
      "resolved": "https://registry.npmjs.org/@rolldown/pluginutils/-/pluginutils-1.0.0-rc.3.tgz",
      "integrity": "sha512-eybk3TjzzzV97Dlj5c+XrBFW57eTNhzod66y9HrBlzJ6NsCrWCp/2kaPS3K9wJmurBC0Tdw4yPjXKZqlznim3Q==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@rollup/rollup-android-arm-eabi": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-android-arm-eabi/-/rollup-android-arm-eabi-4.62.2.tgz",
      "integrity": "sha512-6o7ZLZK+BeenkZCFNDXqpbjw9bD6nuWonvS/lwQJp7NoVVxm6p3qE7qQ5jGuBjiFsgvqjD8mZAU5oWxTmbOeOg==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ]
    },
    "node_modules/@rollup/rollup-android-arm64": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-android-arm64/-/rollup-android-arm64-4.62.2.tgz",
      "integrity": "sha512-BaH7BllCACHoH1LguOU56UItGfUWjujlO65kS9LAodViaN4bwIKd7oeW/ZHJ/4ljr/7MIiENnNy3HJ0zXv8Zkw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ]
    },
    "node_modules/@rollup/rollup-darwin-arm64": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-darwin-arm64/-/rollup-darwin-arm64-4.62.2.tgz",
      "integrity": "sha512-v39RCCvj4He82I9sFmk+M1VZ0PLM9sfsLVikjfx2hYBNALhrrOR2D3JjQA6AhlaSOgcR+RzrKY7e1+bT6SUO/A==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ]
    },
    "node_modules/@rollup/rollup-darwin-x64": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-darwin-x64/-/rollup-darwin-x64-4.62.2.tgz",
      "integrity": "sha512-yl0y2vq3S3lHeuXhEdss6TWfKW8vkujImO12tn4ZkG/4oghr09LvdYm2RElVjokTQiUvDUGXLGsYeLqUMCKpGA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ]
    },
    "node_modules/@rollup/rollup-freebsd-arm64": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-freebsd-arm64/-/rollup-freebsd-arm64-4.62.2.tgz",
      "integrity": "sha512-tT4pvt4qXD+vEoezupCWi+a1F0vvDiksiHc+PxRlYTOH1I6/X4id9jPxTP+Fg+545euaFT1jJVs4CEdHZAU1vw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ]
    },
    "node_modules/@rollup/rollup-freebsd-x64": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-freebsd-x64/-/rollup-freebsd-x64-4.62.2.tgz",
      "integrity": "sha512-6nU5F2wCW+qvCBhTn1pdIU3bzsIoF7EUwsCDRxilWGprQR6yd508YnH9+OKFCwpfS8pjZqDUmnCAr7exax0XCg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm-gnueabihf": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm-gnueabihf/-/rollup-linux-arm-gnueabihf-4.62.2.tgz",
      "integrity": "sha512-n1GJHPOvpIfhi3TmrCeh6S6URt9BFCt0KQE3qvexyGCTAKpR4Lg+eWvNZEqu7epxwus/8ElT3hacYEucm49SZg==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm-musleabihf": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm-musleabihf/-/rollup-linux-arm-musleabihf-4.62.2.tgz",
      "integrity": "sha512-JqgflS8wEB+UXV/vS1RpRbifGBeN4D5lz8D8oOFbFZw4vedvdOgCFAjfBmIMdW3yL10XpQQ0Ambepw6MXrhOnA==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm64-gnu": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm64-gnu/-/rollup-linux-arm64-gnu-4.62.2.tgz",
      "integrity": "sha512-wnFJkogWvN4jm/hQRF2UBaeUmk20j5+DmHvoyWii2b8HJDyvz1MF2OU/6ynXt2KR63rbZLWkFpoytpdc/yBuSA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm64-musl": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm64-musl/-/rollup-linux-arm64-musl-4.62.2.tgz",
      "integrity": "sha512-HVu2bp0zhvJ8xHEV9+UUs7S90VadmBSY3LcIMvozbPo4AuMGDWlz3ymHLHZPX4hR67TKTt8Qp5PJ5RBg/i+RMQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-loong64-gnu": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-loong64-gnu/-/rollup-linux-loong64-gnu-4.62.2.tgz",
      "integrity": "sha512-mQqqAV8QaoSgr9I2fKDLY2BAVvmKjWoGiu/cSYQonsLvtqwEn1E4QYfnCOcp5zoEqNhsDYin1s6jx/VJmrxlZg==",
      "cpu": [
        "loong64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-loong64-musl": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-loong64-musl/-/rollup-linux-loong64-musl-4.62.2.tgz",
      "integrity": "sha512-IxKLoxCQ2IWi6bT2akyDUBGsOImDKB+sPp4EsTmwFQ/fMwpCKm8uLSSgP/Kx/QYUgKis6SEZ5/Nlhup0DIA0PQ==",
      "cpu": [
        "loong64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-ppc64-gnu": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-ppc64-gnu/-/rollup-linux-ppc64-gnu-4.62.2.tgz",
      "integrity": "sha512-Mk5ha2RQSgyFfmYYLkBpPnUk8D8FriBxesO1u9O75X0mHgXL1UQcH5Itl2lurWL2tj0RxV9b9tJgipac0hRY9A==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-ppc64-musl": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-ppc64-musl/-/rollup-linux-ppc64-musl-4.62.2.tgz",
      "integrity": "sha512-CjvEnqJL/0/TQ3TXX3OPIJ/kmBellrWd4heXUmHeJlTnmwjKpSJzoehLaL6Xk0ZnMHBu9dZuFADNOrtjF4v+2w==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-riscv64-gnu": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-riscv64-gnu/-/rollup-linux-riscv64-gnu-4.62.2.tgz",
      "integrity": "sha512-1SiZbzwdkaDURsew/tSOrooKiYy7EQGT6m8ufavAi9NEyQb/6VuIxFXAL1fqa4iZe3g4NbNk4P7J32z2tw5Mgg==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-riscv64-musl": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-riscv64-musl/-/rollup-linux-riscv64-musl-4.62.2.tgz",
      "integrity": "sha512-nQts12zJ3NQRoE6uYljOH89v7szzLDvG2JD/vsX+vGXU8w/At1GowTZ5/7qeFQ8m7L55rpR8Okugnuo5bgjy2Q==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-s390x-gnu": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-s390x-gnu/-/rollup-linux-s390x-gnu-4.62.2.tgz",
      "integrity": "sha512-E9/ll019jhPIJgpzfZoIkBGhcz+kKNgVWYRY0zr9srBdPPFVpvOKW8VaJKUbeK+eZXyQF9ltME+Kk6affeaPgg==",
      "cpu": [
        "s390x"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-x64-gnu": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-x64-gnu/-/rollup-linux-x64-gnu-4.62.2.tgz",
      "integrity": "sha512-5BqxR/pshjey51iliyzTD5Xi3EN0aLmQ2lZ3lvefVV9c82BvrLo2/6OT55iifpWBufs6kdwWbuOKS841DrmK9A==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-x64-musl": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-x64-musl/-/rollup-linux-x64-musl-4.62.2.tgz",
      "integrity": "sha512-uNN83XxQrRAh/w0/pmAfibcwyb6YWt4gP+dpnQKPVJshAloQ785ii8CT8ZCIxkGg9opVsvAlGhFitSm6D1Jjpg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-openbsd-x64": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-openbsd-x64/-/rollup-openbsd-x64-4.62.2.tgz",
      "integrity": "sha512-srjEIxSH3LRnJN6THczDHWQplqEMFiAJrTab0msUryh9kwNpkICf3Ea6q6MN/2cZwRFUNx5w+h6Hpi4QuHS6Zg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ]
    },
    "node_modules/@rollup/rollup-openharmony-arm64": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-openharmony-arm64/-/rollup-openharmony-arm64-4.62.2.tgz",
      "integrity": "sha512-8hOJnxgbyObnCm5AlRA3A931xX19xq80RjVTKgJOvEKWqJruP/Uf12IbAOaDjjEXYRewwHLfmF0YRIdK3OwKWA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openharmony"
      ]
    },
    "node_modules/@rollup/rollup-win32-arm64-msvc": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-arm64-msvc/-/rollup-win32-arm64-msvc-4.62.2.tgz",
      "integrity": "sha512-mmF4AY1i0hG/bLWUctUq59gtmgaSIRa3cu/A3JFRp/sCNEme2bgDEiDS22P9FbnJB8NJNF4jPJiSP5RHQpUTDg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-ia32-msvc": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-ia32-msvc/-/rollup-win32-ia32-msvc-4.62.2.tgz",
      "integrity": "sha512-DZgkknc6jhHrk46V25vbAM0zZkyP0nSDkJB8/dRkLTxv470dOmWDqGoEJl/9A0dFfS7yE3REOwNDxpHwSLSt0Q==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-x64-gnu": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-x64-gnu/-/rollup-win32-x64-gnu-4.62.2.tgz",
      "integrity": "sha512-T6xr6ucWSFto+VGajA8YH26LdpHRuP4YLHEKAtCWvJDOlnmWcDZVCI2Jmjr+IFHDlt2zRaTAKE4tfjTaWLgJBg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-x64-msvc": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-x64-msvc/-/rollup-win32-x64-msvc-4.62.2.tgz",
      "integrity": "sha512-BfzEnDJOt9T8M989/lA37EcJgat01wLRnoi5dQf3QzOH7jzpqTAzdDbVfRljVr5r+jzKqpbHeyOfAaXxAd0PAA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@sindresorhus/is": {
      "version": "7.2.0",
      "resolved": "https://registry.npmjs.org/@sindresorhus/is/-/is-7.2.0.tgz",
      "integrity": "sha512-P1Cz1dWaFfR4IR+U13mqqiGsLFf1KbayybWwdd2vfctdV6hDpUkgCY0nKOLLTMSoRd/jJNjtbqzf13K8DCCXQw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "url": "https://github.com/sindresorhus/is?sponsor=1"
      }
    },
    "node_modules/@speed-highlight/core": {
      "version": "1.2.17",
      "resolved": "https://registry.npmjs.org/@speed-highlight/core/-/core-1.2.17.tgz",
      "integrity": "sha512-Z92FwKpCtfaW1V0jTU/fh3QzYEZN8wDwrzRIBoADCJfn4mJCNcJN/XegifX7BDrQ8/h9Xh/JnbyMchL0FqXrkg==",
      "dev": true,
      "license": "CC0-1.0"
    },
    "node_modules/@supabase/auth-js": {
      "version": "2.110.0",
      "resolved": "https://registry.npmjs.org/@supabase/auth-js/-/auth-js-2.110.0.tgz",
      "integrity": "sha512-Mi288WCTp6wxMFCOu/UgzgHEXODjdl2uVTLqK11eanzGZaldU3RyP8Am+ZbNuVzFP+5+iOvppxzv7N5Ym84xTg==",
      "license": "MIT",
      "dependencies": {
        "tslib": "2.8.1"
      },
      "engines": {
        "node": ">=22.0.0"
      }
    },
    "node_modules/@supabase/functions-js": {
      "version": "2.110.0",
      "resolved": "https://registry.npmjs.org/@supabase/functions-js/-/functions-js-2.110.0.tgz",
      "integrity": "sha512-Fde5wlY8ZZy+9yqrWlQHo8MacSyUBArBEtN2boB4thJQigPnQD/cc61qZN0n3I1L0gwhWtHYwIMnOBKxSvF6Hw==",
      "license": "MIT",
      "dependencies": {
        "tslib": "2.8.1"
      },
      "engines": {
        "node": ">=22.0.0"
      }
    },
    "node_modules/@supabase/phoenix": {
      "version": "0.4.4",
      "resolved": "https://registry.npmjs.org/@supabase/phoenix/-/phoenix-0.4.4.tgz",
      "integrity": "sha512-Gt0pqoXuIqX/8dvG0OKp/wMCobXNH3klNbUPBNyOfN0YA1IswrM3HyWFMOPk1Jy+BRaIyDPcFx4jLBwHNmlyfQ==",
      "license": "MIT"
    },
    "node_modules/@supabase/postgrest-js": {
      "version": "2.110.0",
      "resolved": "https://registry.npmjs.org/@supabase/postgrest-js/-/postgrest-js-2.110.0.tgz",
      "integrity": "sha512-ZbC1QZL3jcvBUfVKjJbgRM27G4Mg3Zzqdm44m5pJafe1e52Cli793EOnwQucomBAGEUDd03Nzaf7XV3ji/XexQ==",
      "license": "MIT",
      "dependencies": {
        "tslib": "2.8.1"
      },
      "engines": {
        "node": ">=22.0.0"
      }
    },
    "node_modules/@supabase/realtime-js": {
      "version": "2.110.0",
      "resolved": "https://registry.npmjs.org/@supabase/realtime-js/-/realtime-js-2.110.0.tgz",
      "integrity": "sha512-Wn2AWpneZuDFTkp/65tqctvoh+3JvyTjMam8sTMqVWy5BgkU8zAvFwilPYPPPhkINeKF8NAJKP7FclJ2iGCUMw==",
      "license": "MIT",
      "dependencies": {
        "@supabase/phoenix": "0.4.4",
        "tslib": "2.8.1"
      },
      "engines": {
        "node": ">=22.0.0"
      }
    },
    "node_modules/@supabase/ssr": {
      "version": "0.12.0",
      "resolved": "https://registry.npmjs.org/@supabase/ssr/-/ssr-0.12.0.tgz",
      "integrity": "sha512-d9XV5XzJvzzZbeAIM7fWTCUYxQJZ2Ru6ny3dJHmHGp/LIrJ+o9FpD7N9Rf/UhhWEvHXSoDe8SI32Z2ouOdMjBg==",
      "license": "MIT",
      "dependencies": {
        "cookie": "^1.0.2"
      },
      "peerDependencies": {
        "@supabase/supabase-js": "^2.108.0"
      }
    },
    "node_modules/@supabase/storage-js": {
      "version": "2.110.0",
      "resolved": "https://registry.npmjs.org/@supabase/storage-js/-/storage-js-2.110.0.tgz",
      "integrity": "sha512-71+gU3HrhiylAhftY6FmO5PPdcsScnVcS766CVD+vTYK9qTDLbrx8FhgBYbqGm3iV/wkTfzrNJfjGsMeFRkJRQ==",
      "license": "MIT",
      "dependencies": {
        "iceberg-js": "^0.8.1",
        "tslib": "2.8.1"
      },
      "engines": {
        "node": ">=22.0.0"
      }
    },
    "node_modules/@supabase/supabase-js": {
      "version": "2.110.0",
      "resolved": "https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-2.110.0.tgz",
      "integrity": "sha512-8yI84VJiEVW4zxZpLUmxXmjzQ7O2St9X/ymzlBETDHTURPWG3LmvbSiibq+7dqAJmyoUfxZnSfXeM4HCM8s4XQ==",
      "license": "MIT",
      "dependencies": {
        "@supabase/auth-js": "2.110.0",
        "@supabase/functions-js": "2.110.0",
        "@supabase/postgrest-js": "2.110.0",
        "@supabase/realtime-js": "2.110.0",
        "@supabase/storage-js": "2.110.0"
      },
      "engines": {
        "node": ">=22.0.0"
      }
    },
    "node_modules/@tailwindcss/node": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/node/-/node-4.3.2.tgz",
      "integrity": "sha512-yWP/sqEcBLaD8JuA6zNwxoYKr75qxTioYwlRwekj5Jr/I5GXnoJfjetH/psLUIv74cYTH2lBUEzBkinthoYcBg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/remapping": "^2.3.5",
        "enhanced-resolve": "5.21.6",
        "jiti": "^2.7.0",
        "lightningcss": "1.32.0",
        "magic-string": "^0.30.21",
        "source-map-js": "^1.2.1",
        "tailwindcss": "4.3.2"
      }
    },
    "node_modules/@tailwindcss/oxide": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide/-/oxide-4.3.2.tgz",
      "integrity": "sha512-z8ZgnzX8gdNoWLBLqBPoh/sjnxkwvf9ZuWjnO0l0yIzbLa5/9S+eC5QxGZKRobVHIC3/1BoMWjHblqWjcgFgag==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 20"
      },
      "optionalDependencies": {
        "@tailwindcss/oxide-android-arm64": "4.3.2",
        "@tailwindcss/oxide-darwin-arm64": "4.3.2",
        "@tailwindcss/oxide-darwin-x64": "4.3.2",
        "@tailwindcss/oxide-freebsd-x64": "4.3.2",
        "@tailwindcss/oxide-linux-arm-gnueabihf": "4.3.2",
        "@tailwindcss/oxide-linux-arm64-gnu": "4.3.2",
        "@tailwindcss/oxide-linux-arm64-musl": "4.3.2",
        "@tailwindcss/oxide-linux-x64-gnu": "4.3.2",
        "@tailwindcss/oxide-linux-x64-musl": "4.3.2",
        "@tailwindcss/oxide-wasm32-wasi": "4.3.2",
        "@tailwindcss/oxide-win32-arm64-msvc": "4.3.2",
        "@tailwindcss/oxide-win32-x64-msvc": "4.3.2"
      }
    },
    "node_modules/@tailwindcss/oxide-android-arm64": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-android-arm64/-/oxide-android-arm64-4.3.2.tgz",
      "integrity": "sha512-WHxqIuHpvZ5VtdX6GTl1Ik/Vp2YuN42Et+0CdeaVd/frQ9jAvGmvR8vLT+jk3e8/Q3x8kECB9+R17pgpp2BulA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-darwin-arm64": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-darwin-arm64/-/oxide-darwin-arm64-4.3.2.tgz",
      "integrity": "sha512-GZypeUY/IDJW3877KeM+O67vbXr3MBnbtEL4aYhNErv/JWZhye2vGSWWG9tB6iiqR2MqRNkY8IOUy4NdSZV26w==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-darwin-x64": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-darwin-x64/-/oxide-darwin-x64-4.3.2.tgz",
      "integrity": "sha512-UIIzmefR6KO1sDU7MzRqAxC8iBpft/VhkGjTjnhoS6k7Z3rQ9wEgA1ODSiyH/tcSYssulNm4Ci3hOeK1jH7ccQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-freebsd-x64": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-freebsd-x64/-/oxide-freebsd-x64-4.3.2.tgz",
      "integrity": "sha512-GN+uAmcI6DNspnCDwtOAZrTz6oukJnp337qZvxqCGLd3BHBzJpO0ZbTLRvJNdztOeAmTzewewGIMPb0tk2R4WA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-arm-gnueabihf": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-arm-gnueabihf/-/oxide-linux-arm-gnueabihf-4.3.2.tgz",
      "integrity": "sha512-4ABn7qSbdHRwTiDiuWNegCyb5+2FJ4vKIKc3DmKrvAFw7MU1Lm11dIkTPwUaFdTzc7IsOpDbqBrlh0x6y36U/w==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-arm64-gnu": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-arm64-gnu/-/oxide-linux-arm64-gnu-4.3.2.tgz",
      "integrity": "sha512-wDgEIGwoM8w8pufh9LVt1PahDgNdKXrLC2qfAnV3vAmococ9RWbxeAw4pxPttd/TsJfwjyLf90Dg1y9y8I6Emw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-arm64-musl": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-arm64-musl/-/oxide-linux-arm64-musl-4.3.2.tgz",
      "integrity": "sha512-J5Nuk0uZQIiMTJj3LEx4sAA9tMFUoXQZFv1J6An+QGYe53HKRJuFDi0rpq/tuouCZeAbOBY3kQ6g8qeD4TUjtA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-x64-gnu": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-x64-gnu/-/oxide-linux-x64-gnu-4.3.2.tgz",
      "integrity": "sha512-kqCZpSKOBEJO4mz7OqWoofBZeXTAwaVGPj0ErAj7CojmhKpWVWVOnrt9dE8odoIraZq4oj3ausM37kXi+Tow8w==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-x64-musl": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-x64-musl/-/oxide-linux-x64-musl-4.3.2.tgz",
      "integrity": "sha512-cixpqbh2toJDmkuCRI68nXA8ZxNmdK9Y+9v5h3MC3ZQKy/0BO8AWzlkWyRM7JAFSGBlfig4YVTPsK6MVgqz1uw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-wasm32-wasi": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-4.3.2.tgz",
      "integrity": "sha512-4ec2Z/LOmRsAgU23CS4xeJfcJlmRg94A/XrbGRCF1gyU/zdDfRLYDVsS+ynSZCmGNxQ1jQriQOKMQeQxBA3Isw==",
      "bundleDependencies": [
        "@napi-rs/wasm-runtime",
        "@emnapi/core",
        "@emnapi/runtime",
        "@tybys/wasm-util",
        "@emnapi/wasi-threads",
        "tslib"
      ],
      "cpu": [
        "wasm32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "@emnapi/core": "^1.11.1",
        "@emnapi/runtime": "^1.11.1",
        "@emnapi/wasi-threads": "^1.2.2",
        "@napi-rs/wasm-runtime": "^1.1.4",
        "@tybys/wasm-util": "^0.10.2",
        "tslib": "^2.8.1"
      },
      "engines": {
        "node": ">=14.0.0"
      }
    },
    "node_modules/@tailwindcss/oxide-win32-arm64-msvc": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-win32-arm64-msvc/-/oxide-win32-arm64-msvc-4.3.2.tgz",
      "integrity": "sha512-Zyr/M0+XcYZu3bZrUytc7TXvrk0ftWfl8gN2MwekNDzhqhKRUucMPSeOzM0o0wH5AWOU49BsKRrfKxI2atCPMQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-win32-x64-msvc": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-win32-x64-msvc/-/oxide-win32-x64-msvc-4.3.2.tgz",
      "integrity": "sha512-QI9BO7KlNZsp2GuO0jwAAj5jCDABOKXRkCk2XuKTSaNEFSdfzqswYVTtCHBNKHLsqyjFyFkqlDiwkNbTYSssMQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/postcss": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/@tailwindcss/postcss/-/postcss-4.3.2.tgz",
      "integrity": "sha512-rjVWYCa7Ngbi5AarT6k8TkxUG3Wl1QKzHdIZVsjZSzf36Jmo2IKZt/NHRAwly8oDkbBOH0YTu+CHuf9jPxMc+g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@alloc/quick-lru": "^5.2.0",
        "@tailwindcss/node": "4.3.2",
        "@tailwindcss/oxide": "4.3.2",
        "postcss": "^8.5.15",
        "tailwindcss": "4.3.2"
      }
    },
    "node_modules/@types/babel__core": {
      "version": "7.20.5",
      "resolved": "https://registry.npmjs.org/@types/babel__core/-/babel__core-7.20.5.tgz",
      "integrity": "sha512-qoQprZvz5wQFJwMDqeseRXWv3rqMvhgpbXFfVyWhbx9X47POIA6i/+dXefEmZKoAgOaTdaIgNSMqMIU61yRyzA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.20.7",
        "@babel/types": "^7.20.7",
        "@types/babel__generator": "*",
        "@types/babel__template": "*",
        "@types/babel__traverse": "*"
      }
    },
    "node_modules/@types/babel__generator": {
      "version": "7.27.0",
      "resolved": "https://registry.npmjs.org/@types/babel__generator/-/babel__generator-7.27.0.tgz",
      "integrity": "sha512-ufFd2Xi92OAVPYsy+P4n7/U7e68fex0+Ee8gSG9KX7eo084CWiQ4sdxktvdl0bOPupXtVJPY19zk6EwWqUQ8lg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.0.0"
      }
    },
    "node_modules/@types/babel__template": {
      "version": "7.4.4",
      "resolved": "https://registry.npmjs.org/@types/babel__template/-/babel__template-7.4.4.tgz",
      "integrity": "sha512-h/NUaSyG5EyxBIp8YRxo4RMe2/qQgvyowRwVMzhYhBCONbW8PUsg4lkFMrhgZhUe5z3L3MiLDuvyJ/CaPa2A8A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.1.0",
        "@babel/types": "^7.0.0"
      }
    },
    "node_modules/@types/babel__traverse": {
      "version": "7.28.0",
      "resolved": "https://registry.npmjs.org/@types/babel__traverse/-/babel__traverse-7.28.0.tgz",
      "integrity": "sha512-8PvcXf70gTDZBgt9ptxJ8elBeBjcLOAcOtoO/mPJjtji1+CdGbHgm77om1GrsPxsiE+uXIpNSK64UYaIwQXd4Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.28.2"
      }
    },
    "node_modules/@types/estree": {
      "version": "1.0.9",
      "resolved": "https://registry.npmjs.org/@types/estree/-/estree-1.0.9.tgz",
      "integrity": "sha512-GhdPgy1el4/ImP05X05Uw4cw2/M93BCUmnEvWZNStlCzEKME4Fkk+YpoA5OiHNQmoS7Cafb8Xa3Pya8m1Qrzeg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/node": {
      "version": "26.1.0",
      "resolved": "https://registry.npmjs.org/@types/node/-/node-26.1.0.tgz",
      "integrity": "sha512-O0A1G3xPGy4w7AgQdAQYUlQ+BKk2Oovw8eRpofyp5KdBZULnbe+WqaOVNrm705SHphCiG4XHsACrSmPu1f+Kgw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "undici-types": "~8.3.0"
      }
    },
    "node_modules/@types/react": {
      "version": "19.2.17",
      "resolved": "https://registry.npmjs.org/@types/react/-/react-19.2.17.tgz",
      "integrity": "sha512-MXfmqaVPEVgkBT/aY0aGCkRWWtByiYQXo3xdQ8r5RzuFrPiRn8Gar2tQdXSUQ2GKV3bkXckek89V8wQBY2Q/Aw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "csstype": "^3.2.2"
      }
    },
    "node_modules/@types/react-dom": {
      "version": "19.2.3",
      "resolved": "https://registry.npmjs.org/@types/react-dom/-/react-dom-19.2.3.tgz",
      "integrity": "sha512-jp2L/eY6fn+KgVVQAOqYItbF0VY/YApe5Mz2F0aykSO8gx31bYCZyvSeYxCHKvzHG5eZjc+zyaS5BrBWya2+kQ==",
      "dev": true,
      "license": "MIT",
      "peerDependencies": {
        "@types/react": "^19.2.0"
      }
    },
    "node_modules/@vitejs/plugin-react": {
      "version": "5.2.0",
      "resolved": "https://registry.npmjs.org/@vitejs/plugin-react/-/plugin-react-5.2.0.tgz",
      "integrity": "sha512-YmKkfhOAi3wsB1PhJq5Scj3GXMn3WvtQ/JC0xoopuHoXSdmtdStOpFrYaT1kie2YgFBcIe64ROzMYRjCrYOdYw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/core": "^7.29.0",
        "@babel/plugin-transform-react-jsx-self": "^7.27.1",
        "@babel/plugin-transform-react-jsx-source": "^7.27.1",
        "@rolldown/pluginutils": "1.0.0-rc.3",
        "@types/babel__core": "^7.20.5",
        "react-refresh": "^0.18.0"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "peerDependencies": {
        "vite": "^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0"
      }
    },
    "node_modules/abort-controller": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/abort-controller/-/abort-controller-3.0.0.tgz",
      "integrity": "sha512-h8lQ8tacZYnR3vNQTgibj+tODHI5/+l06Au2Pcriv/Gmet0eaj4TwWH41sO9wnHDiQsEj19q0drzdWdeAHtweg==",
      "license": "MIT",
      "dependencies": {
        "event-target-shim": "^5.0.0"
      },
      "engines": {
        "node": ">=6.5"
      }
    },
    "node_modules/abortcontroller-polyfill": {
      "version": "1.7.8",
      "resolved": "https://registry.npmjs.org/abortcontroller-polyfill/-/abortcontroller-polyfill-1.7.8.tgz",
      "integrity": "sha512-9f1iZ2uWh92VcrU9Y8x+LdM4DLj75VE0MJB8zuF1iUnroEptStw+DQ8EQPMUdfe5k+PkB1uUfDQfWbhstH8LrQ==",
      "license": "MIT"
    },
    "node_modules/airtable": {
      "version": "0.12.2",
      "resolved": "https://registry.npmjs.org/airtable/-/airtable-0.12.2.tgz",
      "integrity": "sha512-HS3VytUBTKj8A0vPl7DDr5p/w3IOGv6RXL0fv7eczOWAtj9Xe8ri4TAiZRXoOyo+Z/COADCj+oARFenbxhmkIg==",
      "license": "MIT",
      "dependencies": {
        "@types/node": ">=8.0.0 <15",
        "abort-controller": "^3.0.0",
        "abortcontroller-polyfill": "^1.4.0",
        "lodash": "^4.17.21",
        "node-fetch": "^2.6.7"
      },
      "engines": {
        "node": ">=8.0.0"
      }
    },
    "node_modules/airtable/node_modules/@types/node": {
      "version": "14.18.63",
      "resolved": "https://registry.npmjs.org/@types/node/-/node-14.18.63.tgz",
      "integrity": "sha512-fAtCfv4jJg+ExtXhvCkCqUKZ+4ok/JQk01qDKhL5BDDoS3AxKXhV5/MAVUZyQnSEd2GT92fkgZl0pz0Q0AzcIQ==",
      "license": "MIT"
    },
    "node_modules/autoprefixer": {
      "version": "10.5.2",
      "resolved": "https://registry.npmjs.org/autoprefixer/-/autoprefixer-10.5.2.tgz",
      "integrity": "sha512-rD5t5DwOjJdmSORcTq64j8MawTC+tbQ+HHqjR4NDumamy/ambn1UJrlKL+KdwujWxMkFjPM3pPHOEA9tl4767Q==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/postcss/"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/autoprefixer"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "browserslist": "^4.28.4",
        "caniuse-lite": "^1.0.30001799",
        "fraction.js": "^5.3.4",
        "picocolors": "^1.1.1",
        "postcss-value-parser": "^4.2.0"
      },
      "bin": {
        "autoprefixer": "bin/autoprefixer"
      },
      "engines": {
        "node": "^10 || ^12 || >=14"
      },
      "peerDependencies": {
        "postcss": "^8.1.0"
      }
    },
    "node_modules/baseline-browser-mapping": {
      "version": "2.10.40",
      "resolved": "https://registry.npmjs.org/baseline-browser-mapping/-/baseline-browser-mapping-2.10.40.tgz",
      "integrity": "sha512-BSSLZ9/Cjjv7Gtj5B68ZzXcXUg8iOf3fme+FCuh8rC/Go+Kmh8cox7M3A8dolou16s64QjLPOSdngh7GxXvkSw==",
      "dev": true,
      "license": "Apache-2.0",
      "bin": {
        "baseline-browser-mapping": "dist/cli.cjs"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/blake3-wasm": {
      "version": "2.1.5",
      "resolved": "https://registry.npmjs.org/blake3-wasm/-/blake3-wasm-2.1.5.tgz",
      "integrity": "sha512-F1+K8EbfOZE49dtoPtmxUQrpXaBIl3ICvasLh+nJta0xkz+9kF/7uet9fLnwKqhDrmj6g+6K3Tw9yQPUg2ka5g==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/browserslist": {
      "version": "4.28.4",
      "resolved": "https://registry.npmjs.org/browserslist/-/browserslist-4.28.4.tgz",
      "integrity": "sha512-MTc8i/x9jBQd1iMw2CFGS+rwMa07eYjLR0CCTLDACl9xhxy+nIs3KeML/biicXtk9JrZ6dnnTatmc7ErPXIxqw==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/browserslist"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "baseline-browser-mapping": "^2.10.38",
        "caniuse-lite": "^1.0.30001799",
        "electron-to-chromium": "^1.5.376",
        "node-releases": "^2.0.48",
        "update-browserslist-db": "^1.2.3"
      },
      "bin": {
        "browserslist": "cli.js"
      },
      "engines": {
        "node": "^6 || ^7 || ^8 || ^9 || ^10 || ^11 || ^12 || >=13.7"
      }
    },
    "node_modules/caniuse-lite": {
      "version": "1.0.30001800",
      "resolved": "https://registry.npmjs.org/caniuse-lite/-/caniuse-lite-1.0.30001800.tgz",
      "integrity": "sha512-MMHtuAz9Ys840zAY5F4k6fV5GaivZ9sPk+nz0mY+GYVzRBnYkN0mpqkSR92oWRQ19yQWo4HvBV/FnC16AJX8MA==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/caniuse-lite"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "CC-BY-4.0"
    },
    "node_modules/convert-source-map": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/convert-source-map/-/convert-source-map-2.0.0.tgz",
      "integrity": "sha512-Kvp459HrV2FEJ1CAsi1Ku+MY3kasH19TFykTz2xWmMeq6bk2NU3XXvfJ+Q61m0xktWwt+1HSYf3JZsTms3aRJg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/cookie": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/cookie/-/cookie-1.1.1.tgz",
      "integrity": "sha512-ei8Aos7ja0weRpFzJnEA9UHJ/7XQmqglbRwnf2ATjcB9Wq874VKH9kfjjirM6UhU2/E5fFYadylyhFldcqSidQ==",
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/csstype": {
      "version": "3.2.3",
      "resolved": "https://registry.npmjs.org/csstype/-/csstype-3.2.3.tgz",
      "integrity": "sha512-z1HGKcYy2xA8AGQfwrn0PAy+PB7X/GSj3UVJW9qKyn43xWa+gl5nXmU4qqLMRzWVLFC8KusUX8T/0kCiOYpAIQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/date-fns": {
      "version": "4.4.0",
      "resolved": "https://registry.npmjs.org/date-fns/-/date-fns-4.4.0.tgz",
      "integrity": "sha512-+1UMbeh68lH1SegH83CGWwpb6OHHbpSgr3+s5Eww5M4CAgswBpoWS0AjTOfEJ33HiYKz1hdj/KTFprzXHmq/6w==",
      "license": "MIT",
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/kossnocorp"
      }
    },
    "node_modules/debug": {
      "version": "4.4.3",
      "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
      "integrity": "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ms": "^2.1.3"
      },
      "engines": {
        "node": ">=6.0"
      },
      "peerDependenciesMeta": {
        "supports-color": {
          "optional": true
        }
      }
    },
    "node_modules/detect-libc": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/detect-libc/-/detect-libc-2.1.2.tgz",
      "integrity": "sha512-Btj2BOOO83o3WyH59e8MgXsxEQVcarkUOpEYrubB0urwnN10yQ364rsiByU11nZlqWYZm05i/of7io4mzihBtQ==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/electron-to-chromium": {
      "version": "1.5.384",
      "resolved": "https://registry.npmjs.org/electron-to-chromium/-/electron-to-chromium-1.5.384.tgz",
      "integrity": "sha512-g6KAKY1vkYsADvSPWvdJsuYT0ixdcu6lUtD9P/wJKGBEDlZVXh2AX42j1mPqqaQPDluWjara9ziQ7xqAeXCt5A==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/enhanced-resolve": {
      "version": "5.21.6",
      "resolved": "https://registry.npmjs.org/enhanced-resolve/-/enhanced-resolve-5.21.6.tgz",
      "integrity": "sha512-aNnGCvbJ/RIyWo1IuhNdVjnNF+EjH9wpzpNHt+ci/m9He9LJvUN8wrCcXjp9cWsGNAuvSpVFTx/vraAFQ8qGjQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "graceful-fs": "^4.2.4",
        "tapable": "^2.3.3"
      },
      "engines": {
        "node": ">=10.13.0"
      }
    },
    "node_modules/error-stack-parser-es": {
      "version": "1.0.5",
      "resolved": "https://registry.npmjs.org/error-stack-parser-es/-/error-stack-parser-es-1.0.5.tgz",
      "integrity": "sha512-5qucVt2XcuGMcEGgWI7i+yZpmpByQ8J1lHhcL7PwqCwu9FPP3VUXzT4ltHe5i2z9dePwEHcDVOAfSnHsOlCXRA==",
      "dev": true,
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/antfu"
      }
    },
    "node_modules/esbuild": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/esbuild/-/esbuild-0.28.1.tgz",
      "integrity": "sha512-HrJrvZv5ayxBzPfwphOoNzkzOIIlifzk0KJrGK2c8R4+LKpMtpYLQeUdjnwjWv/LZlkH2laZk+4w78pi99D4Vw==",
      "dev": true,
      "hasInstallScript": true,
      "license": "MIT",
      "bin": {
        "esbuild": "bin/esbuild"
      },
      "engines": {
        "node": ">=18"
      },
      "optionalDependencies": {
        "@esbuild/aix-ppc64": "0.28.1",
        "@esbuild/android-arm": "0.28.1",
        "@esbuild/android-arm64": "0.28.1",
        "@esbuild/android-x64": "0.28.1",
        "@esbuild/darwin-arm64": "0.28.1",
        "@esbuild/darwin-x64": "0.28.1",
        "@esbuild/freebsd-arm64": "0.28.1",
        "@esbuild/freebsd-x64": "0.28.1",
        "@esbuild/linux-arm": "0.28.1",
        "@esbuild/linux-arm64": "0.28.1",
        "@esbuild/linux-ia32": "0.28.1",
        "@esbuild/linux-loong64": "0.28.1",
        "@esbuild/linux-mips64el": "0.28.1",
        "@esbuild/linux-ppc64": "0.28.1",
        "@esbuild/linux-riscv64": "0.28.1",
        "@esbuild/linux-s390x": "0.28.1",
        "@esbuild/linux-x64": "0.28.1",
        "@esbuild/netbsd-arm64": "0.28.1",
        "@esbuild/netbsd-x64": "0.28.1",
        "@esbuild/openbsd-arm64": "0.28.1",
        "@esbuild/openbsd-x64": "0.28.1",
        "@esbuild/openharmony-arm64": "0.28.1",
        "@esbuild/sunos-x64": "0.28.1",
        "@esbuild/win32-arm64": "0.28.1",
        "@esbuild/win32-ia32": "0.28.1",
        "@esbuild/win32-x64": "0.28.1"
      }
    },
    "node_modules/escalade": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/escalade/-/escalade-3.2.0.tgz",
      "integrity": "sha512-WUj2qlxaQtO4g6Pq5c29GTcWGDyd8itL8zTlipgECz3JesAiiOKotd8JU6otB3PACgG6xkJUyVhboMS+bje/jA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/event-target-shim": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/event-target-shim/-/event-target-shim-5.0.1.tgz",
      "integrity": "sha512-i/2XbnSz/uxRCU6+NdVJgKWDTM427+MqYbkQzD321DuCQJUqOuJKIA0IM2+W2xtYHdKOmZ4dR6fExsd4SXL+WQ==",
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/fdir": {
      "version": "6.5.0",
      "resolved": "https://registry.npmjs.org/fdir/-/fdir-6.5.0.tgz",
      "integrity": "sha512-tIbYtZbucOs0BRGqPJkshJUYdL+SDH7dVM8gjy+ERp3WAUjLEFJE+02kanyHtwjWOnwrKYBiwAmM0p4kLJAnXg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12.0.0"
      },
      "peerDependencies": {
        "picomatch": "^3 || ^4"
      },
      "peerDependenciesMeta": {
        "picomatch": {
          "optional": true
        }
      }
    },
    "node_modules/fraction.js": {
      "version": "5.3.4",
      "resolved": "https://registry.npmjs.org/fraction.js/-/fraction.js-5.3.4.tgz",
      "integrity": "sha512-1X1NTtiJphryn/uLQz3whtY6jK3fTqoE3ohKs0tT+Ujr1W59oopxmoEh7Lu5p6vBaPbgoM0bzveAW4Qi5RyWDQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "*"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/rawify"
      }
    },
    "node_modules/fsevents": {
      "version": "2.3.3",
      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
      "integrity": "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
      "dev": true,
      "hasInstallScript": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^8.16.0 || ^10.6.0 || >=11.0.0"
      }
    },
    "node_modules/gensync": {
      "version": "1.0.0-beta.2",
      "resolved": "https://registry.npmjs.org/gensync/-/gensync-1.0.0-beta.2.tgz",
      "integrity": "sha512-3hN7NaskYvMDLQY55gnW3NQ+mesEAepTqlg+VEbj7zzqEMBVNhzcGYYeqFo/TlYz6eQiFcp1HcsCZO+nGgS8zg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/graceful-fs": {
      "version": "4.2.11",
      "resolved": "https://registry.npmjs.org/graceful-fs/-/graceful-fs-4.2.11.tgz",
      "integrity": "sha512-RbJ5/jmFcNNCcDV5o9eTnBLJ/HszWV0P73bc+Ff4nS/rJj+YaS6IGyiOL0VoBYX+l1Wrl3k63h/KrH+nhJ0XvQ==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/iceberg-js": {
      "version": "0.8.1",
      "resolved": "https://registry.npmjs.org/iceberg-js/-/iceberg-js-0.8.1.tgz",
      "integrity": "sha512-1dhVQZXhcHje7798IVM+xoo/1ZdVfzOMIc8/rgVSijRK38EDqOJoGula9N/8ZI5RD8QTxNQtK/Gozpr+qUqRRA==",
      "license": "MIT",
      "engines": {
        "node": ">=20.0.0"
      }
    },
    "node_modules/jiti": {
      "version": "2.7.0",
      "resolved": "https://registry.npmjs.org/jiti/-/jiti-2.7.0.tgz",
      "integrity": "sha512-AC/7JofJvZGrrneWNaEnJeOLUx+JlGt7tNa0wZiRPT4MY1wmfKjt2+6O2p2uz2+skll8OZZmJMNqeke7kKbNgQ==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "jiti": "lib/jiti-cli.mjs"
      }
    },
    "node_modules/js-tokens": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/js-tokens/-/js-tokens-4.0.0.tgz",
      "integrity": "sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/jsesc": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/jsesc/-/jsesc-3.1.0.tgz",
      "integrity": "sha512-/sM3dO2FOzXjKQhJuo0Q173wf2KOo8t4I8vHy6lF9poUp7bKT0/NHE8fPX23PwfhnykfqnC2xRxOnVw5XuGIaA==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "jsesc": "bin/jsesc"
      },
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/json5": {
      "version": "2.2.3",
      "resolved": "https://registry.npmjs.org/json5/-/json5-2.2.3.tgz",
      "integrity": "sha512-XmOWe7eyHYH14cLdVPoyg+GOH3rYX++KpzrylJwSW98t3Nk+U8XOl8FWKOgwtzdb8lXGf6zYwDUzeHMWfxasyg==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "json5": "lib/cli.js"
      },
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/kleur": {
      "version": "4.1.5",
      "resolved": "https://registry.npmjs.org/kleur/-/kleur-4.1.5.tgz",
      "integrity": "sha512-o+NO+8WrRiQEE4/7nwRJhN1HWpVmJm511pBHUxPLtp0BUISzlBplORYSmTclCnJvQq2tKu/sgl3xVpkc7ZWuQQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/lightningcss": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss/-/lightningcss-1.32.0.tgz",
      "integrity": "sha512-NXYBzinNrblfraPGyrbPoD19C1h9lfI/1mzgWYvXUTe414Gz/X1FD2XBZSZM7rRTrMA8JL3OtAaGifrIKhQ5yQ==",
      "dev": true,
      "license": "MPL-2.0",
      "dependencies": {
        "detect-libc": "^2.0.3"
      },
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      },
      "optionalDependencies": {
        "lightningcss-android-arm64": "1.32.0",
        "lightningcss-darwin-arm64": "1.32.0",
        "lightningcss-darwin-x64": "1.32.0",
        "lightningcss-freebsd-x64": "1.32.0",
        "lightningcss-linux-arm-gnueabihf": "1.32.0",
        "lightningcss-linux-arm64-gnu": "1.32.0",
        "lightningcss-linux-arm64-musl": "1.32.0",
        "lightningcss-linux-x64-gnu": "1.32.0",
        "lightningcss-linux-x64-musl": "1.32.0",
        "lightningcss-win32-arm64-msvc": "1.32.0",
        "lightningcss-win32-x64-msvc": "1.32.0"
      }
    },
    "node_modules/lightningcss-android-arm64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-android-arm64/-/lightningcss-android-arm64-1.32.0.tgz",
      "integrity": "sha512-YK7/ClTt4kAK0vo6w3X+Pnm0D2cf2vPHbhOXdoNti1Ga0al1P4TBZhwjATvjNwLEBCnKvjJc2jQgHXH0NEwlAg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-darwin-arm64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-darwin-arm64/-/lightningcss-darwin-arm64-1.32.0.tgz",
      "integrity": "sha512-RzeG9Ju5bag2Bv1/lwlVJvBE3q6TtXskdZLLCyfg5pt+HLz9BqlICO7LZM7VHNTTn/5PRhHFBSjk5lc4cmscPQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-darwin-x64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-darwin-x64/-/lightningcss-darwin-x64-1.32.0.tgz",
      "integrity": "sha512-U+QsBp2m/s2wqpUYT/6wnlagdZbtZdndSmut/NJqlCcMLTWp5muCrID+K5UJ6jqD2BFshejCYXniPDbNh73V8w==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-freebsd-x64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-freebsd-x64/-/lightningcss-freebsd-x64-1.32.0.tgz",
      "integrity": "sha512-JCTigedEksZk3tHTTthnMdVfGf61Fky8Ji2E4YjUTEQX14xiy/lTzXnu1vwiZe3bYe0q+SpsSH/CTeDXK6WHig==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm-gnueabihf": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm-gnueabihf/-/lightningcss-linux-arm-gnueabihf-1.32.0.tgz",
      "integrity": "sha512-x6rnnpRa2GL0zQOkt6rts3YDPzduLpWvwAF6EMhXFVZXD4tPrBkEFqzGowzCsIWsPjqSK+tyNEODUBXeeVHSkw==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm64-gnu": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm64-gnu/-/lightningcss-linux-arm64-gnu-1.32.0.tgz",
      "integrity": "sha512-0nnMyoyOLRJXfbMOilaSRcLH3Jw5z9HDNGfT/gwCPgaDjnx0i8w7vBzFLFR1f6CMLKF8gVbebmkUN3fa/kQJpQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm64-musl": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm64-musl/-/lightningcss-linux-arm64-musl-1.32.0.tgz",
      "integrity": "sha512-UpQkoenr4UJEzgVIYpI80lDFvRmPVg6oqboNHfoH4CQIfNA+HOrZ7Mo7KZP02dC6LjghPQJeBsvXhJod/wnIBg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-x64-gnu": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-x64-gnu/-/lightningcss-linux-x64-gnu-1.32.0.tgz",
      "integrity": "sha512-V7Qr52IhZmdKPVr+Vtw8o+WLsQJYCTd8loIfpDaMRWGUZfBOYEJeyJIkqGIDMZPwPx24pUMfwSxxI8phr/MbOA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-x64-musl": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-x64-musl/-/lightningcss-linux-x64-musl-1.32.0.tgz",
      "integrity": "sha512-bYcLp+Vb0awsiXg/80uCRezCYHNg1/l3mt0gzHnWV9XP1W5sKa5/TCdGWaR/zBM2PeF/HbsQv/j2URNOiVuxWg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-win32-arm64-msvc": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-win32-arm64-msvc/-/lightningcss-win32-arm64-msvc-1.32.0.tgz",
      "integrity": "sha512-8SbC8BR40pS6baCM8sbtYDSwEVQd4JlFTOlaD3gWGHfThTcABnNDBda6eTZeqbofalIJhFx0qKzgHJmcPTnGdw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-win32-x64-msvc": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-win32-x64-msvc/-/lightningcss-win32-x64-msvc-1.32.0.tgz",
      "integrity": "sha512-Amq9B/SoZYdDi1kFrojnoqPLxYhQ4Wo5XiL8EVJrVsB8ARoC1PWW6VGtT0WKCemjy8aC+louJnjS7U18x3b06Q==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lodash": {
      "version": "4.18.1",
      "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.18.1.tgz",
      "integrity": "sha512-dMInicTPVE8d1e5otfwmmjlxkZoUpiVLwyeTdUsi/Caj/gfzzblBcCE5sRHV/AsjuCmxWrte2TNGSYuCeCq+0Q==",
      "license": "MIT"
    },
    "node_modules/lru-cache": {
      "version": "5.1.1",
      "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-5.1.1.tgz",
      "integrity": "sha512-KpNARQA3Iwv+jTA0utUVVbrh+Jlrr1Fv0e56GGzAFOXN7dk/FviaDW8LHmK52DlcH4WP2n6gI8vN1aesBFgo9w==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "yallist": "^3.0.2"
      }
    },
    "node_modules/lucide-react": {
      "version": "1.23.0",
      "resolved": "https://registry.npmjs.org/lucide-react/-/lucide-react-1.23.0.tgz",
      "integrity": "sha512-38BpJcD0JhFosxHApP/BYsBetLpQFRoTRzEzstM/XCc3jsAG7wqaY1lgVwxiUe3xqYE+lNxo2PkCmYwXWrwwIw==",
      "license": "ISC",
      "peerDependencies": {
        "react": "^16.5.1 || ^17.0.0 || ^18.0.0 || ^19.0.0"
      }
    },
    "node_modules/magic-string": {
      "version": "0.30.21",
      "resolved": "https://registry.npmjs.org/magic-string/-/magic-string-0.30.21.tgz",
      "integrity": "sha512-vd2F4YUyEXKGcLHoq+TEyCjxueSeHnFxyyjNp80yg0XV4vUhnDer/lvvlqM/arB5bXQN5K2/3oinyCRyx8T2CQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/sourcemap-codec": "^1.5.5"
      }
    },
    "node_modules/miniflare": {
      "version": "4.20260630.0",
      "resolved": "https://registry.npmjs.org/miniflare/-/miniflare-4.20260630.0.tgz",
      "integrity": "sha512-lyRplDrSJJWVpzSSQPBSQtNmUuxScCZyOOkXFs37uSbdTfWRDDmw6DyFKVS2s1eYtA/i4u2xR/0FyPIsTl/HJw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@cspotcode/source-map-support": "0.8.1",
        "sharp": "0.34.5",
        "undici": "7.28.0",
        "workerd": "1.20260630.1",
        "ws": "8.21.0",
        "youch": "4.1.0-beta.10"
      },
      "bin": {
        "miniflare": "bootstrap.js"
      },
      "engines": {
        "node": ">=22.0.0"
      }
    },
    "node_modules/ms": {
      "version": "2.1.3",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/nanoid": {
      "version": "3.3.15",
      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.15.tgz",
      "integrity": "sha512-y7Wygv/7mEOvxTuEQDB8StXdMRBWf1kR/tlhAzBRUFkB2jfcLOAxO/SHmOO2zgz1pVgK29/kyupn059/bCHdjA==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "bin": {
        "nanoid": "bin/nanoid.cjs"
      },
      "engines": {
        "node": "^10 || ^12 || ^13.7 || ^14 || >=15.0.1"
      }
    },
    "node_modules/node-fetch": {
      "version": "2.7.0",
      "resolved": "https://registry.npmjs.org/node-fetch/-/node-fetch-2.7.0.tgz",
      "integrity": "sha512-c4FRfUm/dbcWZ7U+1Wq0AwCyFL+3nt2bEw05wfxSz+DWpWsitgmSgYmy2dQdWyKC1694ELPqMs/YzUSNozLt8A==",
      "license": "MIT",
      "dependencies": {
        "whatwg-url": "^5.0.0"
      },
      "engines": {
        "node": "4.x || >=6.0.0"
      },
      "peerDependencies": {
        "encoding": "^0.1.0"
      },
      "peerDependenciesMeta": {
        "encoding": {
          "optional": true
        }
      }
    },
    "node_modules/node-releases": {
      "version": "2.0.50",
      "resolved": "https://registry.npmjs.org/node-releases/-/node-releases-2.0.50.tgz",
      "integrity": "sha512-J6l92tKHX6w8Jy5nO1Vuc01NoIiRGi/d6qBKVxh+IQ8Cr3b6HbVNfKiF8ZpFKufTwpwxMmce2W3iQZ861ZRyTg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/path-to-regexp": {
      "version": "6.3.0",
      "resolved": "https://registry.npmjs.org/path-to-regexp/-/path-to-regexp-6.3.0.tgz",
      "integrity": "sha512-Yhpw4T9C6hPpgPeA28us07OJeqZ5EzQTkbfwuhsUg0c237RomFoETJgmp2sa3F/41gfLE6G5cqcYwznmeEeOlQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/pathe": {
      "version": "2.0.3",
      "resolved": "https://registry.npmjs.org/pathe/-/pathe-2.0.3.tgz",
      "integrity": "sha512-WUjGcAqP1gQacoQe+OBJsFA7Ld4DyXuUIjZ5cc75cLHvJ7dtNsTugphxIADwspS+AraAUePCKrSVtPLFj/F88w==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/picocolors": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz",
      "integrity": "sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/picomatch": {
      "version": "4.0.4",
      "resolved": "https://registry.npmjs.org/picomatch/-/picomatch-4.0.4.tgz",
      "integrity": "sha512-QP88BAKvMam/3NxH6vj2o21R6MjxZUAd6nlwAS/pnGvN9IVLocLHxGYIzFhg6fUQ+5th6P4dv4eW9jX3DSIj7A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/jonschlinkert"
      }
    },
    "node_modules/postcss": {
      "version": "8.5.16",
      "resolved": "https://registry.npmjs.org/postcss/-/postcss-8.5.16.tgz",
      "integrity": "sha512-vuwillviilfKZsg0VGj5R/YwwcHx4SLsIOI/7K6mQkWx+l5cUHTjj5g0AasTBcyXsbfTgrwsUNmVUb5xVwyPwg==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/postcss/"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/postcss"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "nanoid": "^3.3.12",
        "picocolors": "^1.1.1",
        "source-map-js": "^1.2.1"
      },
      "engines": {
        "node": "^10 || ^12 || >=14"
      }
    },
    "node_modules/postcss-value-parser": {
      "version": "4.2.0",
      "resolved": "https://registry.npmjs.org/postcss-value-parser/-/postcss-value-parser-4.2.0.tgz",
      "integrity": "sha512-1NNCs6uurfkVbeXG4S8JFT9t19m45ICnif8zWLd5oPSZ50QnwMfK+H3jv408d4jw/7Bttv5axS5IiHoLaVNHeQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/react": {
      "version": "19.2.7",
      "resolved": "https://registry.npmjs.org/react/-/react-19.2.7.tgz",
      "integrity": "sha512-HNe9WslTbXmFK8o8cmwgAeJFSBvt1bPdHCVKtaaV+WlAN36mpT4hcRpwbf3fY56ar2oIXzsBpOAiIRHAdY0OlQ==",
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/react-dom": {
      "version": "19.2.7",
      "resolved": "https://registry.npmjs.org/react-dom/-/react-dom-19.2.7.tgz",
      "integrity": "sha512-t0BRVXvbiE/o20Hfw669rLbMCDWtYZLvmJigy2f0MxsXF+71pxhR3xOkspmsO8h3ZlNzyibAmtCa3l4lYKk6gQ==",
      "license": "MIT",
      "dependencies": {
        "scheduler": "^0.27.0"
      },
      "peerDependencies": {
        "react": "^19.2.7"
      }
    },
    "node_modules/react-refresh": {
      "version": "0.18.0",
      "resolved": "https://registry.npmjs.org/react-refresh/-/react-refresh-0.18.0.tgz",
      "integrity": "sha512-QgT5//D3jfjJb6Gsjxv0Slpj23ip+HtOpnNgnb2S5zU3CB26G/IDPGoy4RJB42wzFE46DRsstbW6tKHoKbhAxw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/react-router": {
      "version": "7.18.1",
      "resolved": "https://registry.npmjs.org/react-router/-/react-router-7.18.1.tgz",
      "integrity": "sha512-GDLgg3i3uM0aeJO3Fm+TCS+sDQ7gu12T6x0qdTEzcwqEfleci7JwugVNIF3U//0FWKnJT7ptG+20B2jfDqnZAg==",
      "license": "MIT",
      "dependencies": {
        "cookie": "^1.0.1",
        "set-cookie-parser": "^2.6.0"
      },
      "engines": {
        "node": ">=20.0.0"
      },
      "peerDependencies": {
        "react": ">=18",
        "react-dom": ">=18"
      },
      "peerDependenciesMeta": {
        "react-dom": {
          "optional": true
        }
      }
    },
    "node_modules/react-router-dom": {
      "version": "7.18.1",
      "resolved": "https://registry.npmjs.org/react-router-dom/-/react-router-dom-7.18.1.tgz",
      "integrity": "sha512-KaZh+X/6UtEp28x51AUYZDMg9NGoz2ja3dNHa+ta/tk40vCzKhQ/RypCWBMLbmDr6//E24Vv5uPsrqXFozdkAg==",
      "license": "MIT",
      "dependencies": {
        "react-router": "7.18.1"
      },
      "engines": {
        "node": ">=20.0.0"
      },
      "peerDependencies": {
        "react": ">=18",
        "react-dom": ">=18"
      }
    },
    "node_modules/rollup": {
      "version": "4.62.2",
      "resolved": "https://registry.npmjs.org/rollup/-/rollup-4.62.2.tgz",
      "integrity": "sha512-RFnrW4lhXA3s3eqHDZvN654g8OTjzRfqpIRJYczCGB6HzphckVAi/Qh4tbPUbRuDi7s1Llv8g/NspLkttY3gTA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/estree": "1.0.9"
      },
      "bin": {
        "rollup": "dist/bin/rollup"
      },
      "engines": {
        "node": ">=18.0.0",
        "npm": ">=8.0.0"
      },
      "optionalDependencies": {
        "@rollup/rollup-android-arm-eabi": "4.62.2",
        "@rollup/rollup-android-arm64": "4.62.2",
        "@rollup/rollup-darwin-arm64": "4.62.2",
        "@rollup/rollup-darwin-x64": "4.62.2",
        "@rollup/rollup-freebsd-arm64": "4.62.2",
        "@rollup/rollup-freebsd-x64": "4.62.2",
        "@rollup/rollup-linux-arm-gnueabihf": "4.62.2",
        "@rollup/rollup-linux-arm-musleabihf": "4.62.2",
        "@rollup/rollup-linux-arm64-gnu": "4.62.2",
        "@rollup/rollup-linux-arm64-musl": "4.62.2",
        "@rollup/rollup-linux-loong64-gnu": "4.62.2",
        "@rollup/rollup-linux-loong64-musl": "4.62.2",
        "@rollup/rollup-linux-ppc64-gnu": "4.62.2",
        "@rollup/rollup-linux-ppc64-musl": "4.62.2",
        "@rollup/rollup-linux-riscv64-gnu": "4.62.2",
        "@rollup/rollup-linux-riscv64-musl": "4.62.2",
        "@rollup/rollup-linux-s390x-gnu": "4.62.2",
        "@rollup/rollup-linux-x64-gnu": "4.62.2",
        "@rollup/rollup-linux-x64-musl": "4.62.2",
        "@rollup/rollup-openbsd-x64": "4.62.2",
        "@rollup/rollup-openharmony-arm64": "4.62.2",
        "@rollup/rollup-win32-arm64-msvc": "4.62.2",
        "@rollup/rollup-win32-ia32-msvc": "4.62.2",
        "@rollup/rollup-win32-x64-gnu": "4.62.2",
        "@rollup/rollup-win32-x64-msvc": "4.62.2",
        "fsevents": "~2.3.2"
      }
    },
    "node_modules/scheduler": {
      "version": "0.27.0",
      "resolved": "https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz",
      "integrity": "sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q==",
      "license": "MIT"
    },
    "node_modules/semver": {
      "version": "6.3.1",
      "resolved": "https://registry.npmjs.org/semver/-/semver-6.3.1.tgz",
      "integrity": "sha512-BR7VvDCVHO+q2xBEWskxS6DJE1qRnb7DxzUrogb71CWoSficBxYsiAGd+Kl0mmq/MprG9yArRkyrQxTO6XjMzA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      }
    },
    "node_modules/set-cookie-parser": {
      "version": "2.7.2",
      "resolved": "https://registry.npmjs.org/set-cookie-parser/-/set-cookie-parser-2.7.2.tgz",
      "integrity": "sha512-oeM1lpU/UvhTxw+g3cIfxXHyJRc/uidd3yK1P242gzHds0udQBYzs3y8j4gCCW+ZJ7ad0yctld8RYO+bdurlvw==",
      "license": "MIT"
    },
    "node_modules/sharp": {
      "version": "0.34.5",
      "resolved": "https://registry.npmjs.org/sharp/-/sharp-0.34.5.tgz",
      "integrity": "sha512-Ou9I5Ft9WNcCbXrU9cMgPBcCK8LiwLqcbywW3t4oDV37n1pzpuNLsYiAV8eODnjbtQlSDwZ2cUEeQz4E54Hltg==",
      "dev": true,
      "hasInstallScript": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@img/colour": "^1.0.0",
        "detect-libc": "^2.1.2",
        "semver": "^7.7.3"
      },
      "engines": {
        "node": "^18.17.0 || ^20.3.0 || >=21.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-darwin-arm64": "0.34.5",
        "@img/sharp-darwin-x64": "0.34.5",
        "@img/sharp-libvips-darwin-arm64": "1.2.4",
        "@img/sharp-libvips-darwin-x64": "1.2.4",
        "@img/sharp-libvips-linux-arm": "1.2.4",
        "@img/sharp-libvips-linux-arm64": "1.2.4",
        "@img/sharp-libvips-linux-ppc64": "1.2.4",
        "@img/sharp-libvips-linux-riscv64": "1.2.4",
        "@img/sharp-libvips-linux-s390x": "1.2.4",
        "@img/sharp-libvips-linux-x64": "1.2.4",
        "@img/sharp-libvips-linuxmusl-arm64": "1.2.4",
        "@img/sharp-libvips-linuxmusl-x64": "1.2.4",
        "@img/sharp-linux-arm": "0.34.5",
        "@img/sharp-linux-arm64": "0.34.5",
        "@img/sharp-linux-ppc64": "0.34.5",
        "@img/sharp-linux-riscv64": "0.34.5",
        "@img/sharp-linux-s390x": "0.34.5",
        "@img/sharp-linux-x64": "0.34.5",
        "@img/sharp-linuxmusl-arm64": "0.34.5",
        "@img/sharp-linuxmusl-x64": "0.34.5",
        "@img/sharp-wasm32": "0.34.5",
        "@img/sharp-win32-arm64": "0.34.5",
        "@img/sharp-win32-ia32": "0.34.5",
        "@img/sharp-win32-x64": "0.34.5"
      }
    },
    "node_modules/sharp/node_modules/semver": {
      "version": "7.8.5",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.8.5.tgz",
      "integrity": "sha512-Y7/KDsb8LjooZpwaqGyulO6DQlksgCncchHGk+sZIY4SBvUocMBEFH5Ur1fI4dV+Jvl0w6cjvucaIi40puRioA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/sonner": {
      "version": "2.0.7",
      "resolved": "https://registry.npmjs.org/sonner/-/sonner-2.0.7.tgz",
      "integrity": "sha512-W6ZN4p58k8aDKA4XPcx2hpIQXBRAgyiWVkYhT7CvK6D3iAu7xjvVyhQHg2/iaKJZ1XVJ4r7XuwGL+WGEK37i9w==",
      "license": "MIT",
      "peerDependencies": {
        "react": "^18.0.0 || ^19.0.0 || ^19.0.0-rc",
        "react-dom": "^18.0.0 || ^19.0.0 || ^19.0.0-rc"
      }
    },
    "node_modules/source-map-js": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz",
      "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
      "dev": true,
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/supports-color": {
      "version": "10.2.2",
      "resolved": "https://registry.npmjs.org/supports-color/-/supports-color-10.2.2.tgz",
      "integrity": "sha512-SS+jx45GF1QjgEXQx4NJZV9ImqmO2NPz5FNsIHrsDjh2YsHnawpan7SNQ1o8NuhrbHZy9AZhIoCUiCeaW/C80g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "url": "https://github.com/chalk/supports-color?sponsor=1"
      }
    },
    "node_modules/tailwindcss": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/tailwindcss/-/tailwindcss-4.3.2.tgz",
      "integrity": "sha512-WtctNNSH8A9jlMIqxzuYumOHU5uGZyRv0Q5svQl+oEPy5w84YpBxdb7MdqyiSPQge5jTJ6zFQLq0PFygdccSBA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/tailwindcss-animate": {
      "version": "1.0.7",
      "resolved": "https://registry.npmjs.org/tailwindcss-animate/-/tailwindcss-animate-1.0.7.tgz",
      "integrity": "sha512-bl6mpH3T7I3UFxuvDEXLxy/VuFxBk5bbzplh7tXI68mwMokNYd1t9qPBHlnyTwfa4JGC4zP516I1hYYtQ/vspA==",
      "dev": true,
      "license": "MIT",
      "peerDependencies": {
        "tailwindcss": ">=3.0.0 || insiders"
      }
    },
    "node_modules/tapable": {
      "version": "2.3.3",
      "resolved": "https://registry.npmjs.org/tapable/-/tapable-2.3.3.tgz",
      "integrity": "sha512-uxc/zpqFg6x7C8vOE7lh6Lbda8eEL9zmVm/PLeTPBRhh1xCgdWaQ+J1CUieGpIfm2HdtsUpRv+HshiasBMcc6A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/webpack"
      }
    },
    "node_modules/tinyglobby": {
      "version": "0.2.17",
      "resolved": "https://registry.npmjs.org/tinyglobby/-/tinyglobby-0.2.17.tgz",
      "integrity": "sha512-wXR/dYpcqKmfWpEdZjiKJOwCNFndD0DMnrW/cYjVGttEkBfVgcLFHoNrlj47mjOVic9yyNu65alsgF4NQyTa2g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "fdir": "^6.5.0",
        "picomatch": "^4.0.4"
      },
      "engines": {
        "node": ">=12.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/SuperchupuDev"
      }
    },
    "node_modules/tr46": {
      "version": "0.0.3",
      "resolved": "https://registry.npmjs.org/tr46/-/tr46-0.0.3.tgz",
      "integrity": "sha512-N3WMsuqV66lT30CrXNbEjx4GEwlow3v6rr4mCcv6prnfwhS01rkgyFdjPNBYd9br7LpXV1+Emh01fHnq2Gdgrw==",
      "license": "MIT"
    },
    "node_modules/tslib": {
      "version": "2.8.1",
      "resolved": "https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz",
      "integrity": "sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==",
      "license": "0BSD"
    },
    "node_modules/typescript": {
      "version": "5.9.3",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz",
      "integrity": "sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==",
      "dev": true,
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=14.17"
      }
    },
    "node_modules/undici": {
      "version": "7.28.0",
      "resolved": "https://registry.npmjs.org/undici/-/undici-7.28.0.tgz",
      "integrity": "sha512-cRZYrTDwWznlnRiPjggAGxZXanty6M8RV1ff8Wm4LWXBp7/IG8v5DnOm74DtUBp9OONpK75YlPnIjQqX0dBDtA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=20.18.1"
      }
    },
    "node_modules/undici-types": {
      "version": "8.3.0",
      "resolved": "https://registry.npmjs.org/undici-types/-/undici-types-8.3.0.tgz",
      "integrity": "sha512-j375ScV60dom+YkPFIfTLcOiPxkN/buHz5GobjLhixFuANaNs3C9l4GmrWqejgXWJ7BbJcFYpTEUkS1Ge8bpZQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/unenv": {
      "version": "2.0.0-rc.24",
      "resolved": "https://registry.npmjs.org/unenv/-/unenv-2.0.0-rc.24.tgz",
      "integrity": "sha512-i7qRCmY42zmCwnYlh9H2SvLEypEFGye5iRmEMKjcGi7zk9UquigRjFtTLz0TYqr0ZGLZhaMHl/foy1bZR+Cwlw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "pathe": "^2.0.3"
      }
    },
    "node_modules/update-browserslist-db": {
      "version": "1.2.3",
      "resolved": "https://registry.npmjs.org/update-browserslist-db/-/update-browserslist-db-1.2.3.tgz",
      "integrity": "sha512-Js0m9cx+qOgDxo0eMiFGEueWztz+d4+M3rGlmKPT+T4IS/jP4ylw3Nwpu6cpTTP8R1MAC1kF4VbdLt3ARf209w==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/browserslist"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "escalade": "^3.2.0",
        "picocolors": "^1.1.1"
      },
      "bin": {
        "update-browserslist-db": "cli.js"
      },
      "peerDependencies": {
        "browserslist": ">= 4.21.0"
      }
    },
    "node_modules/vite": {
      "version": "7.3.6",
      "resolved": "https://registry.npmjs.org/vite/-/vite-7.3.6.tgz",
      "integrity": "sha512-4XP60spRGjSZFf1qYH+dJIkK2znL3zQfl9KkOV9MkkRR/3Dls0dxaBsQPTloEc5BLXWPL9vsOxopxyKoMmDueg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "esbuild": "^0.27.0 || ^0.28.0",
        "fdir": "^6.5.0",
        "picomatch": "^4.0.3",
        "postcss": "^8.5.6",
        "rollup": "^4.43.0",
        "tinyglobby": "^0.2.15"
      },
      "bin": {
        "vite": "bin/vite.js"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "funding": {
        "url": "https://github.com/vitejs/vite?sponsor=1"
      },
      "optionalDependencies": {
        "fsevents": "~2.3.3"
      },
      "peerDependencies": {
        "@types/node": "^20.19.0 || >=22.12.0",
        "jiti": ">=1.21.0",
        "less": "^4.0.0",
        "lightningcss": "^1.21.0",
        "sass": "^1.70.0",
        "sass-embedded": "^1.70.0",
        "stylus": ">=0.54.8",
        "sugarss": "^5.0.0",
        "terser": "^5.16.0",
        "tsx": "^4.8.1",
        "yaml": "^2.4.2"
      },
      "peerDependenciesMeta": {
        "@types/node": {
          "optional": true
        },
        "jiti": {
          "optional": true
        },
        "less": {
          "optional": true
        },
        "lightningcss": {
          "optional": true
        },
        "sass": {
          "optional": true
        },
        "sass-embedded": {
          "optional": true
        },
        "stylus": {
          "optional": true
        },
        "sugarss": {
          "optional": true
        },
        "terser": {
          "optional": true
        },
        "tsx": {
          "optional": true
        },
        "yaml": {
          "optional": true
        }
      }
    },
    "node_modules/webidl-conversions": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/webidl-conversions/-/webidl-conversions-3.0.1.tgz",
      "integrity": "sha512-2JAn3z8AR6rjK8Sm8orRC0h/bcl/DqL7tRPdGZ4I1CjdF+EaMLmYxBHyXuKL849eucPFhvBoxMsflfOb8kxaeQ==",
      "license": "BSD-2-Clause"
    },
    "node_modules/whatwg-url": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/whatwg-url/-/whatwg-url-5.0.0.tgz",
      "integrity": "sha512-saE57nupxk6v3HY35+jzBwYa0rKSy0XR8JSxZPwgLr7ys0IBzhGviA1/TUGJLmSVqs8pb9AnvICXEuOHLprYTw==",
      "license": "MIT",
      "dependencies": {
        "tr46": "~0.0.3",
        "webidl-conversions": "^3.0.0"
      }
    },
    "node_modules/workerd": {
      "version": "1.20260630.1",
      "resolved": "https://registry.npmjs.org/workerd/-/workerd-1.20260630.1.tgz",
      "integrity": "sha512-7M0AA4l14hmPGtzQ5YPHyXosIKI/uz3TdcPHeiFDbgb7/0c8ECVMzIaodSV5bZIVhDHL0OlzqITAdPiwAr+dTg==",
      "dev": true,
      "hasInstallScript": true,
      "license": "Apache-2.0",
      "bin": {
        "workerd": "bin/workerd"
      },
      "engines": {
        "node": ">=16"
      },
      "optionalDependencies": {
        "@cloudflare/workerd-darwin-64": "1.20260630.1",
        "@cloudflare/workerd-darwin-arm64": "1.20260630.1",
        "@cloudflare/workerd-linux-64": "1.20260630.1",
        "@cloudflare/workerd-linux-arm64": "1.20260630.1",
        "@cloudflare/workerd-windows-64": "1.20260630.1"
      }
    },
    "node_modules/wrangler": {
      "version": "4.106.0",
      "resolved": "https://registry.npmjs.org/wrangler/-/wrangler-4.106.0.tgz",
      "integrity": "sha512-b6EVbsvbmAUY4bUQXT3+f8oFP8x+J5rEa5z3Akeh+6vyKiN4x8+PyZ53DPpnqdxhIihhq/a00Yq5chGJ19QXBQ==",
      "dev": true,
      "license": "MIT OR Apache-2.0",
      "dependencies": {
        "@cloudflare/kv-asset-handler": "0.5.0",
        "@cloudflare/unenv-preset": "2.16.1",
        "blake3-wasm": "2.1.5",
        "esbuild": "0.28.1",
        "miniflare": "4.20260630.0",
        "path-to-regexp": "6.3.0",
        "unenv": "2.0.0-rc.24",
        "workerd": "1.20260630.1"
      },
      "bin": {
        "cf-wrangler": "bin/cf-wrangler.js",
        "wrangler": "bin/wrangler.js",
        "wrangler2": "bin/wrangler.js"
      },
      "engines": {
        "node": ">=22.0.0"
      },
      "optionalDependencies": {
        "fsevents": "2.3.3"
      },
      "peerDependencies": {
        "@cloudflare/workers-types": "^4.20260630.1"
      },
      "peerDependenciesMeta": {
        "@cloudflare/workers-types": {
          "optional": true
        }
      }
    },
    "node_modules/ws": {
      "version": "8.21.0",
      "resolved": "https://registry.npmjs.org/ws/-/ws-8.21.0.tgz",
      "integrity": "sha512-Vsp28b7DRcimFQvrqu2Wek3z1iYxDCWqHYB8Qsnk/S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH+g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10.0.0"
      },
      "peerDependencies": {
        "bufferutil": "^4.0.1",
        "utf-8-validate": ">=5.0.2"
      },
      "peerDependenciesMeta": {
        "bufferutil": {
          "optional": true
        },
        "utf-8-validate": {
          "optional": true
        }
      }
    },
    "node_modules/yallist": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/yallist/-/yallist-3.1.1.tgz",
      "integrity": "sha512-a4UGQaWPH59mOXUYnAG2ewncQS4i4F43Tv3JoAM+s2VDAmS9NsK8GpDMLrCHPksFT7h3K6TOoUNn2pb7RoXx4g==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/youch": {
      "version": "4.1.0-beta.10",
      "resolved": "https://registry.npmjs.org/youch/-/youch-4.1.0-beta.10.tgz",
      "integrity": "sha512-rLfVLB4FgQneDr0dv1oddCVZmKjcJ6yX6mS4pU82Mq/Dt9a3cLZQ62pDBL4AUO+uVrCvtWz3ZFUL2HFAFJ/BXQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@poppinss/colors": "^4.1.5",
        "@poppinss/dumper": "^0.6.4",
        "@speed-highlight/core": "^1.2.7",
        "cookie": "^1.0.2",
        "youch-core": "^0.3.3"
      }
    },
    "node_modules/youch-core": {
      "version": "0.3.3",
      "resolved": "https://registry.npmjs.org/youch-core/-/youch-core-0.3.3.tgz",
      "integrity": "sha512-ho7XuGjLaJ2hWHoK8yFnsUGy2Y5uDpqSTq1FkHLK4/oqKtyUU1AFbOOxY4IpC9f0fTLjwYbslUz0Po5BpD1wrA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@poppinss/exception": "^1.2.2",
        "error-stack-parser-es": "^1.0.5"
      }
    },
    "node_modules/zod": {
      "version": "4.4.3",
      "resolved": "https://registry.npmjs.org/zod/-/zod-4.4.3.tgz",
      "integrity": "sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ==",
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/colinhacks"
      }
    }
  }
}

### C:\dev\Hockey Trials App\Squad-Selection\package.json

{
  "name": "hkfc-squad-selection",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@supabase/ssr": "^0.12.0",
    "@supabase/supabase-js": "^2.110.0",
    "airtable": "^0.12",
    "date-fns": "^4",
    "lucide-react": "latest",
    "react": "^19",
    "react-dom": "^19",
    "react-router-dom": "^7",
    "sonner": "^2.0.7",
    "zod": "^4"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.2",
    "@types/node": "^26.1.0",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^5",
    "autoprefixer": "^10.5.2",
    "tailwindcss": "^4",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5",
    "vite": "^7",
    "wrangler": "^4"
  }
}

### C:\dev\Hockey Trials App\Squad-Selection\postcss.config.js

export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};

### C:\dev\Hockey Trials App\Squad-Selection\README.md

# Squad-Selection

### C:\dev\Hockey Trials App\Squad-Selection\tailwind.config.ts

import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx,css}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        "3xl": "calc(var(--radius) + 16px)",
        "2xl": "calc(var(--radius) + 8px)",
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        DEFAULT: "calc(var(--radius) - 2px)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        "2xs": "var(--shadow-2xs)",
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        "2xl": "var(--shadow-2xl)",
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;

### C:\dev\Hockey Trials App\Squad-Selection\tsconfig.json

{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,

    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },

    "jsx": "react-jsx",

    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,

    "types": ["vite/client", "node"],
    "ignoreDeprecations": "6.0"
  },
  "include": ["src"],
  "references": []
}

### C:\dev\Hockey Trials App\Squad-Selection\vite.config.ts

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});

### C:\dev\Hockey Trials App\Squad-Selection\src\App.tsx

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/lib/useAuth';
import Login from './pages/Login';
import CoachLayout from './components/CoachLayout';
import FixtureList from './pages/FixtureList';
import SquadSelection from './pages/SquadSelection';
import PlayerDashboard from './pages/PlayerDashboard';
import PlayerFixtures from './pages/PlayerFixtures';

function AppRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<PlayerDashboard />} />
      <Route path="/player/:playerId" element={<PlayerFixtures />} />
      <Route path="/coach" element={<CoachLayout />}>
        <Route index element={<FixtureList />} />
        <Route path="match/:matchId" element={<SquadSelection />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <Toaster />
    </BrowserRouter>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\index.css

@import url("https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700&family=Source+Code+Pro:wght@300;400;500;600;700&display=swap");
@import "tailwindcss";

/* Define your custom theme values */
@theme {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));

  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);

  --font-sans: 'Open Sans', sans-serif;
  --font-mono: 'Source Code Pro', monospace;

  --shadow-2xs: var(--shadow-2xs);
  --shadow-xs: var(--shadow-xs);
  --shadow-sm: var(--shadow-sm);
  --shadow: var(--shadow);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
  --shadow-xl: var(--shadow-xl);
  --shadow-2xl: var(--shadow-2xl);
}

:root {
  --background: 0 0% 100%;
  --foreground: 210 25% 7.8431%;
  --card: 180 6.6667% 97.0588%;
  --card-foreground: 210 25% 7.8431%;
  --popover: 0 0% 100%;
  --popover-foreground: 210 25% 7.8431%;
  --primary: 203.8863 88.2845% 53.1373%;
  --primary-foreground: 0 0% 100%;
  --secondary: 210 25% 7.8431%;
  --secondary-foreground: 0 0% 100%;
  --muted: 240 1.9608% 90%;
  --muted-foreground: 210 25% 7.8431%;
  --accent: 211.5789 51.3514% 92.7451%;
  --accent-foreground: 203.8863 88.2845% 53.1373%;
  --destructive: 356.3033 90.5579% 54.3137%;
  --destructive-foreground: 0 0% 100%;
  --border: 201.4286 30.4348% 90.9804%;
  --input: 200 23.0769% 97.4510%;
  --ring: 202.8169 89.1213% 53.1373%;
  --radius: 1.3rem;
  --sidebar-background: 180 6.6667% 97.0588%;
  --sidebar-foreground: 210 25% 7.8431%;
  --sidebar-primary: 203.8863 88.2845% 53.1373%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 211.5789 51.3514% 92.7451%;
  --sidebar-accent-foreground: 203.8863 88.2845% 53.1373%;
  --sidebar-border: 205.0000 25.0000% 90.5882%;
  --sidebar-ring: 202.8169 89.1213% 53.1373%;
  --font-sans: 'Open Sans', sans-serif;
  --font-mono: 'Source Code Pro', monospace;
  --shadow-x: 0px;
  --shadow-y: 2px;
  --shadow-blur: 0px;
  --shadow-spread: 0px;
  --shadow-opacity: 0;
  --shadow-color: hsl(202.8169 89.1213% 53.1373%);
  --shadow-rgb: 0 0 0;
  --shadow-2xs: var(--shadow-x) var(--shadow-y) var(--shadow-blur) var(--shadow-spread) rgb(var(--shadow-rgb) / calc(var(--shadow-opacity) * 0.5));
  --shadow-xs: var(--shadow-x) var(--shadow-y) var(--shadow-blur) var(--shadow-spread) rgb(var(--shadow-rgb) / calc(var(--shadow-opacity) * 0.5));
  --shadow-sm: var(--shadow-x) var(--shadow-y) var(--shadow-blur) var(--shadow-spread) rgb(var(--shadow-rgb) / var(--shadow-opacity)), var(--shadow-x) calc(var(--shadow-y) / 4) calc(var(--shadow-blur) / 2) calc(var(--shadow-spread) - 1px) rgb(var(--shadow-rgb) / var(--shadow-opacity));
  --shadow: var(--shadow-x) var(--shadow-y) var(--shadow-blur) var(--shadow-spread) rgb(var(--shadow-rgb) / var(--shadow-opacity)), var(--shadow-x) calc(var(--shadow-y) / 2) calc(var(--shadow-blur) / 2) calc(var(--shadow-spread) - 1px) rgb(var(--shadow-rgb) / var(--shadow-opacity));
  --shadow-md: var(--shadow-x) var(--shadow-y) var(--shadow-blur) var(--shadow-spread) rgb(var(--shadow-rgb) / var(--shadow-opacity)), var(--shadow-x) calc(var(--shadow-y) / 2) calc(var(--shadow-blur) * 2) calc(var(--shadow-spread) - 1px) rgb(var(--shadow-rgb) / var(--shadow-opacity));
  --shadow-lg: var(--shadow-x) var(--shadow-y) var(--shadow-blur) var(--shadow-spread) rgb(var(--shadow-rgb) / var(--shadow-opacity)), var(--shadow-x) var(--shadow-y) calc(var(--shadow-blur) * 3) calc(var(--shadow-spread) - 1px) rgb(var(--shadow-rgb) / var(--shadow-opacity));
  --shadow-xl: var(--shadow-x) var(--shadow-y) var(--shadow-blur) var(--shadow-spread) rgb(var(--shadow-rgb) / var(--shadow-opacity)), var(--shadow-x) calc(var(--shadow-y) * 2) calc(var(--shadow-blur) * 5) calc(var(--shadow-spread) - 1px) rgb(var(--shadow-rgb) / var(--shadow-opacity));
  --shadow-2xl: var(--shadow-x) var(--shadow-y) var(--shadow-blur) var(--shadow-spread) rgb(var(--shadow-rgb) / calc(var(--shadow-opacity) * 2.5));
}

@layer base {
  * {
    border-color: hsl(var(--border));
    outline-color: hsl(var(--ring) / 0.5);
  }

  body {
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
}

### C:\dev\Hockey Trials App\Squad-Selection\src\main.tsx

import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

ReactDOM.createRoot(
  document.getElementById("root")!
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

### C:\dev\Hockey Trials App\Squad-Selection\src\api\getClubReferenceData.ts

import { peopleRepository, teamsRepository } from '@/repositories';
import { getCached } from '@/lib/cache';

export type CachedPlayer = {
  id: string;
  preferredName: string;
  givenNames: string;
  surname: string;
  registeredTeam: string;
  playingPosition: string;
  playingAbility: string;
  isSuspended: boolean;
  matchesToServe: number;
  isVisitingPlayer: boolean;
  everRegisteredToPremier: string;
  active: boolean;
};

export type CachedTeam = {
  id: string;
  teamName: string;
  teamRank: number;
  isPremier: boolean;
  targetSquadSize: number;
  active: boolean;
  coach: string[];
  teamCaptain: string[];
  sectionCaptain: string[];
};

export type ReferenceData = {
  players: CachedPlayer[];
  teams: CachedTeam[];
  teamRankMap: Record<string, number>;
  teamNames: string[];
};

export async function fetchReferenceData(): Promise<{ data: ReferenceData; fromCache: boolean }> {
  return getCached<ReferenceData>('club-reference', async () => {
    // Fetch active teams
    const teamsRecords = await teamsRepository.findAll({
      filterByFormula: '{Active}=TRUE()'
    });
    const teams: CachedTeam[] = teamsRecords.map(t => ({
      id: t.id,
      teamName: t.teamName || '',
      teamRank: t.teamRank || 99,
      isPremier: t.isPremier || false,
      targetSquadSize: t.targetSquadSize || 16,
      active: t.active || false,
      coach: t.coach || [],
      teamCaptain: t.teamCaptain || [],
      sectionCaptain: t.sectionCaptain || [],
    }));

    // Fetch active players (pagination support)
    const playerRecords = await peopleRepository.findAll({
      filterByFormula: '{Active}=TRUE()'
    });
    const players: CachedPlayer[] = playerRecords.map(p => ({
      id: p.id,
      preferredName: p.preferredName || '',
      givenNames: p.givenNames || '',
      surname: p.surname || '',
      registeredTeam: p.registeredTeam || '',
      playingPosition: p.playingPosition || '',
      playingAbility: p.playingAbility || '',
      isSuspended: p.isSuspended || false,
      matchesToServe: p.matchesToServe || 0,
      isVisitingPlayer: p.isVisitingPlayer || false,
      everRegisteredToPremier: p.everRegisteredToPremier || '',
      active: p.active || false,
    }));

    const teamRankMap: Record<string, number> = {};
    for (const t of teams) {
      teamRankMap[t.teamName] = t.teamRank;
    }

    return {
      players,
      teams,
      teamRankMap,
      teamNames: teams.map(t => t.teamName),
    };
  });
}

export async function getClubReferenceData(): Promise<ReferenceData> {
  const { data } = await fetchReferenceData();
  return data;
}

### C:\dev\Hockey Trials App\Squad-Selection\src\api\getMyFixtures.ts

import { matchesRepository, selectionsRepository, availabilityRepository } from '@/repositories';
import { getCurrentPeople } from '@/lib/auth';
import { getClubReferenceData } from './getClubReferenceData';

export interface MyFixture {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  division: string;
  availabilityStatus: string;
  playerNotes: string;
  availabilityExceptionId: string;
  selectionStatus: string;
  selectionNotes: string;
  selectedCount: number;
  targetSquadSize: number;
}
export type GetMyFixturesOutput = Awaited<ReturnType<typeof getMyFixtures>>;

export async function getMyFixtures(): Promise<{
  playerName: string;
  registeredTeam: string;
  playingPosition: string;
  shirtNoValue: string;
  isCoach: boolean;
  fixtures: MyFixture[];
}> {
  const user = await getCurrentPeople();
  const teamName = user.registeredTeam || '';
  const roles = Array.isArray(user.playerCoach) ? user.playerCoach : [];
  const isCoach = roles.includes('Coach');

  // Fetch teams for name→rank mapping
  const ref = await getClubReferenceData();
  const teamsByName = new Map(ref.teams.map(t => [t.teamName, t]));
  const teamNames = new Set(ref.teams.map(t => t.teamName));

  // Fetch matches for this team
  const allMatches = await matchesRepository.findAll({
    filterByFormula: '{Match Status}="Scheduled"'
  });
  const now = new Date().toISOString();
  const upcoming = allMatches
    .filter(m => m.matchDate && m.matchDate >= now)
    .filter(m => {
      const home = m.homeTeam || '';
      const away = m.awayTeam || '';
      return home === teamName || away === teamName;
    })
    .sort((a, b) => (a.matchDate || '').localeCompare(b.matchDate || ''));

  if (upcoming.length === 0) {
    return {
      playerName: user.preferredName || user.givenNames || 'Player',
      registeredTeam: teamName,
      playingPosition: user.playingPosition || '',
      shirtNoValue: user.shirtNoValue || '',
      isCoach,
      fixtures: [],
    };
  }

  const matchIds = upcoming.map(m => m.id);

  // Fetch exceptions and selections for these matches
  const allExceptions = await availabilityRepository.findAll({});
  const playerExceptions = allExceptions.filter(e => {
    const pId = Array.isArray(e.player) ? e.player[0] : e.player;
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return pId === user.id && mId && matchIds.includes(mId);
  });
  const exceptionByMatch = new Map(playerExceptions.map(e => {
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return [mId || '', e];
  }));

  const allSelections = await selectionsRepository.findAll({});
  const allMatchSelections = allSelections.filter(s => {
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return mId && matchIds.includes(mId);
  });
  const playerSelections = allMatchSelections.filter(s => {
    const pId = Array.isArray(s.player) ? s.player[0] : s.player;
    return pId === user.id;
  });
  const selectionByMatch = new Map(playerSelections.map(s => {
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return [mId || '', s];
  }));

  // Count selections per match
  const selectedCountByMatch = new Map<string, number>();
  for (const s of allMatchSelections) {
    if (s.selectionStatus !== 'Selected') continue;
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    if (mId) selectedCountByMatch.set(mId, (selectedCountByMatch.get(mId) || 0) + 1);
  }

  const fixtures = upcoming.map(m => {
    const home = m.homeTeam || '';
    const away = m.awayTeam || '';
    const isHome = home === teamName;
    const hkfcTeam = teamNames.has(home) ? home : away;
    const opponent = hkfcTeam === home ? away : home;
    const team = teamsByName.get(hkfcTeam);
    const exc = exceptionByMatch.get(m.id);
    const sel = selectionByMatch.get(m.id);

    return {
      id: m.id,
      date: m.matchDate || '',
      homeTeam: home,
      awayTeam: away,
      hkfcTeam,
      opponent,
      isHome,
      venue: m.venue || '',
      division: m.division || '',
      availabilityStatus: exc?.availabilityStatus || 'Available',
      playerNotes: exc?.note || '',
      availabilityExceptionId: exc?.id || '',
      selectionStatus: sel?.selectionStatus || '',
      selectionNotes: sel?.selectionNotes || '',
      selectedCount: selectedCountByMatch.get(m.id) || 0,
      targetSquadSize: team?.targetSquadSize || 16,
    };
  });

  return {
    playerName: user.preferredName || user.givenNames || 'Player',
    registeredTeam: teamName,
    playingPosition: user.playingPosition || '',
    shirtNoValue: user.shirtNoValue || '',
    isCoach,
    fixtures,
  };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\api\getMyProfile.ts

import { getCurrentPeople } from '@/lib/auth';
import { getClubReferenceData } from './getClubReferenceData';

export interface ProfileData {
  preferredName: string;
  roles: string[];
  isCoach: boolean;
  isAdmin: boolean;
  coachedTeams: {
    id: string;
    teamName: string;
    teamRank: number;
    targetSquadSize: number;
  }[];
}

export async function getMyProfile(): Promise<ProfileData> {
  const user = await getCurrentPeople();
  const roles = Array.isArray(user.playerCoach) ? user.playerCoach : [];
  const isCoach = roles.includes('Coach');

  const ref = await getClubReferenceData();
  const userId = user.id;

  const coachedTeams = ref.teams.filter(t =>
    t.coach.includes(userId) || t.teamCaptain.includes(userId) || t.sectionCaptain.includes(userId)
  );

  return {
    preferredName: user.preferredName || user.givenNames || 'Coach',
    roles,
    isCoach,
    isAdmin: isCoach,
    coachedTeams: coachedTeams
      .map(t => ({
        id: t.id,
        teamName: t.teamName,
        teamRank: t.teamRank,
        targetSquadSize: t.targetSquadSize,
      }))
      .sort((a, b) => a.teamRank - b.teamRank),
  };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\api\getPlayerFixtures.ts

import { peopleRepository, matchesRepository, availabilityRepository, selectionsRepository } from '@/repositories';

export async function getPlayerFixtures(playerId: string) {
  const player = await peopleRepository.findById(playerId);
  if (!player || !player.active) {
    throw new Error('Player not found or inactive');
  }

  const teamName = player.registeredTeam || '';

  const allMatches = await matchesRepository.findAll({
    filterByFormula: '{Match Status}="Scheduled"'
  });
  const now = new Date().toISOString();
  const upcoming = allMatches
    .filter(m => m.matchDate && m.matchDate >= now)
    .filter(m => (m.homeTeam || '') === teamName || (m.awayTeam || '') === teamName)
    .sort((a, b) => (a.matchDate || '').localeCompare(b.matchDate || ''));

  const matchIds = upcoming.map(m => m.id);

  const allExceptions = await availabilityRepository.findAll({});
  const playerExceptions = allExceptions.filter(e => {
    const pId = Array.isArray(e.player) ? e.player[0] : e.player;
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return pId === playerId && mId && matchIds.includes(mId);
  });
  const exceptionByMatch = new Map(playerExceptions.map(e => {
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return [mId || '', e];
  }));

  const allSelections = await selectionsRepository.findAll({});
  const playerSelections = allSelections.filter(s => {
    const pId = Array.isArray(s.player) ? s.player[0] : s.player;
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return pId === playerId && mId && matchIds.includes(mId);
  });
  const selectionByMatch = new Map(playerSelections.map(s => {
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return [mId || '', s];
  }));

  const fixtures = upcoming.map(m => {
    const exc = exceptionByMatch.get(m.id);
    const sel = selectionByMatch.get(m.id);
    return {
      id: m.id,
      date: m.matchDate || '',
      homeTeam: m.homeTeam || '',
      awayTeam: m.awayTeam || '',
      venue: m.venue || '',
      division: m.division || '',
      availabilityStatus: exc?.availabilityStatus || 'Available',
      playerNotes: exc?.note || '',
      availabilityExceptionId: exc?.id || '',
      selectionStatus: sel?.selectionStatus || '',
    };
  });

  return {
    playerName: player.preferredName || player.givenNames || 'Player',
    registeredTeam: teamName,
    fixtures,
  };
}

export type GetPlayerFixturesOutput = Awaited<ReturnType<typeof getPlayerFixtures>>;

### C:\dev\Hockey Trials App\Squad-Selection\src\api\getPlayersForMatch.ts

import { peopleRepository, teamsRepository, matchesRepository, availabilityRepository, selectionsRepository } from '@/repositories';
import { getCurrentPeople } from '@/lib/auth';
import { getClubReferenceData } from './getClubReferenceData';

// Helper to check eligibility and build blocks/warnings
function evaluatePlayerEligibility(
  player: any,
  match: any,
  teamRankMap: Record<string, number>,
  existingSelections: any[],
  playerSelectionsForOtherMatches: any[]
) {
  const blocks: { rule: string; reason: string }[] = [];
  const warnings: { rule: string; reason: string }[] = [];
  const conflicts: { type: string; team: string; matchId: string }[] = [];

  // Suspension
  if (player.isSuspended || (player.matchesToServe && player.matchesToServe > 0)) {
    blocks.push({ rule: 'SUSPENDED', reason: 'Player is suspended' });
  }

  // Higher-to-lower movement (7.2a)
  const home = match.homeTeam || '';
  const away = match.awayTeam || '';
  const hkfcTeam = teamRankMap[home] !== undefined ? home : away;
  const targetTeamRank = teamRankMap[hkfcTeam] || 99;
  const playerTeamRank = teamRankMap[player.registeredTeam || ''] || 99;
  if (playerTeamRank < targetTeamRank) {
    blocks.push({ rule: 'HIGHER_TO_LOWER', reason: 'Higher-to-lower movement blocked (7.2a)' });
  }

  // Visiting player fixed team (6.4)
  if (player.isVisitingPlayer && player.registeredTeam !== hkfcTeam) {
    blocks.push({ rule: 'VISITING_FIXED', reason: 'Visiting player fixed to registered team (6.4)' });
  }

  // Check for duplicate selection in this match
  const alreadySelected = existingSelections.some(s => {
    const pId = Array.isArray(s.player) ? s.player[0] : s.player;
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return pId === player.id && mId === match.id;
  });
  if (alreadySelected) {
    blocks.push({ rule: 'DUPLICATE', reason: 'Already selected for this match' });
  }

  // Conflicts: selected/reserve for other matches on same day? We'll keep as warnings.
  // For simplicity, we'll just show if they are selected for another match on same day.
  // (Not implemented fully; can be added later)

  return { blocks, warnings, conflicts };
}

export async function getPlayersForMatch(matchId: string) {
  const user = await getCurrentPeople(); // need coach permissions? We'll check later.
  const ref = await getClubReferenceData();
  const teamRankMap = ref.teamRankMap;
  const teamsByName = new Map(ref.teams.map(t => [t.teamName, t]));

  const match = await matchesRepository.findById(matchId);
  if (!match) throw new Error('Match not found');

  // Determine HKFC team from match
  const home = match.homeTeam || '';
  const away = match.awayTeam || '';
  const hkfcTeam = teamRankMap[home] !== undefined ? home : away;
  if (!hkfcTeam) throw new Error('Cannot determine HKFC team for this match');

  // Fetch all active players (or those eligible for this team? We'll use all active)
  const allPlayers = await peopleRepository.findAll({
    filterByFormula: '{Active}=TRUE()'
  });

  // Fetch existing selections for this match
  const allSelections = await selectionsRepository.findAll({});
  const matchSelections = allSelections.filter(s => {
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return mId === matchId;
  });
  const selectionMap = new Map<string, any>();
  for (const sel of matchSelections) {
    const pId = Array.isArray(sel.player) ? sel.player[0] : sel.player;
    if (pId) selectionMap.set(pId, sel);
  }

  // Fetch availability exceptions for this match
  const allExceptions = await availabilityRepository.findAll({});
  const matchExceptions = allExceptions.filter(e => {
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return mId === matchId;
  });
  const exceptionMap = new Map<string, any>();
  for (const exc of matchExceptions) {
    const pId = Array.isArray(exc.player) ? exc.player[0] : exc.player;
    if (pId) exceptionMap.set(pId, exc);
  }

  // Build player objects with eligibility
  const players = allPlayers.map(p => {
    const sel = selectionMap.get(p.id);
    const exc = exceptionMap.get(p.id);
    const availabilityStatus = exc?.availabilityStatus || 'Available';
    const playerNotes = exc?.note || '';

    // Compute eligibility
    const eligibility = evaluatePlayerEligibility(
      p,
      match,
      teamRankMap,
      matchSelections,
      [] // conflicts not implemented
    );

    // Determine eligibilityStatus
    let eligibilityStatus = 'eligible';
    if (eligibility.blocks.length > 0) eligibilityStatus = 'blocked';
    else if (eligibility.warnings.length > 0) eligibilityStatus = 'warning';

    // Compute play-up count (placeholder)
    const playUpCount = 0; // would require history

    return {
      id: p.id,
      preferredName: p.preferredName || p.givenNames || '',
      registeredTeam: p.registeredTeam || '',
      playingPosition: p.playingPosition || '',
      playingAbility: p.playingAbility || '',
      availabilityStatus,
      playerNotes,
      playUpCount,
      eligibilityStatus,
      blocks: eligibility.blocks,
      warnings: eligibility.warnings,
      conflicts: eligibility.conflicts,
      selectionStatus: sel?.selectionStatus || '',
      selectionId: sel?.id || '',
    };
  });

  // Sort: selected first, then eligible, then blocked
  players.sort((a, b) => {
    if (a.selectionStatus && !b.selectionStatus) return -1;
    if (!a.selectionStatus && b.selectionStatus) return 1;
    if (a.eligibilityStatus === 'blocked' && b.eligibilityStatus !== 'blocked') return 1;
    if (a.eligibilityStatus !== 'blocked' && b.eligibilityStatus === 'blocked') return -1;
    return 0;
  });

  const matchInfo = {
    date: match.matchDate || '',
    homeTeam: match.homeTeam || '',
    awayTeam: match.awayTeam || '',
    division: match.division || '',
    venue: match.venue || '',
    targetSquadSize: teamsByName.get(hkfcTeam)?.targetSquadSize || 16,
    selectedCount: matchSelections.filter(s => s.selectionStatus === 'Selected').length,
    reserveCount: matchSelections.filter(s => s.selectionStatus === 'Reserve').length,
  };

  return { match: matchInfo, players };
}

export type GetPlayersForMatchOutput = Awaited<ReturnType<typeof getPlayersForMatch>>;

### C:\dev\Hockey Trials App\Squad-Selection\src\api\getUpcomingFixtures.ts

import { matchesRepository, selectionsRepository, availabilityRepository } from '@/repositories';
import { getCurrentPeople } from '@/lib/auth';
import { getClubReferenceData } from './getClubReferenceData';

export interface UpcomingFixture {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  division: string;
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
  reserveCount: number;
  availableCount: number;
  maybeCount: number;
  unavailableCount: number;
}
export type GetUpcomingFixturesOutput = Awaited<ReturnType<typeof getUpcomingFixtures>>;

export async function getUpcomingFixtures(teamFilter?: string): Promise<{ fixtures: UpcomingFixture[] }> {
  const user = await getCurrentPeople();
  const ref = await getClubReferenceData();
  const teamsByName = new Map(ref.teams.map(t => [t.teamName, t]));

  // Find user's coached teams
  const userId = user.id;
  const coachedTeams = ref.teams.filter(t =>
    t.coach.includes(userId) || t.teamCaptain.includes(userId) || t.sectionCaptain.includes(userId)
  );
  const coachedTeamNames = new Set(coachedTeams.map(t => t.teamName));

  // Fetch scheduled matches
  const allMatches = await matchesRepository.findAll({
    filterByFormula: '{Match Status}="Scheduled"'
  });
  const now = new Date().toISOString();
  const upcoming = allMatches
    .filter(m => m.matchDate && m.matchDate >= now)
    .sort((a, b) => (a.matchDate || '').localeCompare(b.matchDate || ''));

  const relevant = upcoming.filter(m => {
    const home = m.homeTeam || '';
    const away = m.awayTeam || '';
    if (teamFilter) {
      return home === teamFilter || away === teamFilter;
    }
    return coachedTeamNames.has(home) || coachedTeamNames.has(away);
  });

  if (relevant.length === 0) {
    return { fixtures: [] };
  }

  // Fetch all selections and exceptions for these matches
  const matchIds = relevant.map(m => m.id);
  const allSelections = await selectionsRepository.findAll({});
  const allExceptions = await availabilityRepository.findAll({});

  const selectionsByMatch = new Map<string, any[]>();
  for (const sel of allSelections) {
    const mId = Array.isArray(sel.match) ? sel.match[0] : sel.match;
    if (!mId || !matchIds.includes(mId)) continue;
    const existing = selectionsByMatch.get(mId) || [];
    existing.push(sel);
    selectionsByMatch.set(mId, existing);
  }

  const exceptionsByMatch = new Map<string, any[]>();
  for (const exc of allExceptions) {
    const mId = Array.isArray(exc.match) ? exc.match[0] : exc.match;
    if (!mId || !matchIds.includes(mId)) continue;
    const existing = exceptionsByMatch.get(mId) || [];
    existing.push(exc);
    exceptionsByMatch.set(mId, existing);
  }

  const fixtures = relevant.map(m => {
    const home = m.homeTeam || '';
    const away = m.awayTeam || '';
    const isHome = coachedTeamNames.has(home) || (teamFilter ? home === teamFilter : false);
    const hkfcTeam = isHome ? home : away;
    const opponent = isHome ? away : home;
    const team = teamsByName.get(hkfcTeam);

    const matchSelections = selectionsByMatch.get(m.id) || [];
    const selectedCount = matchSelections.filter(s => s.selectionStatus === 'Selected').length;
    const reserveCount = matchSelections.filter(s => s.selectionStatus === 'Reserve').length;

    const matchExceptions = exceptionsByMatch.get(m.id) || [];
    const unavailableCount = matchExceptions.filter(e => e.availabilityStatus === 'Unavailable').length;
    const maybeCount = matchExceptions.filter(e => e.availabilityStatus === 'Maybe').length;

    return {
      id: m.id,
      date: m.matchDate || '',
      homeTeam: home,
      awayTeam: away,
      hkfcTeam,
      opponent,
      isHome,
      division: m.division || '',
      venue: m.venue || '',
      targetSquadSize: team?.targetSquadSize || 16,
      selectedCount,
      reserveCount,
      availableCount: 0,
      maybeCount,
      unavailableCount,
    };
  });

  return { fixtures };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\api\removeSelection.ts

import { selectionsRepository } from '@/repositories';

export async function removeSelection(selectionId: string) {
  const sel = await selectionsRepository.findById(selectionId);
  if (!sel) throw new Error('Selection not found');
  await selectionsRepository.delete(selectionId);
  return { success: true };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\api\selectPlayer.ts

import { peopleRepository, teamsRepository, matchesRepository, selectionsRepository, availabilityRepository } from '@/repositories';
import { getCurrentPeople } from '@/lib/auth';
import { getClubReferenceData } from './getClubReferenceData';

export async function selectPlayer(matchId: string, playerId: string, selectionStatus: 'Selected' | 'Reserve') {
  const user = await getCurrentPeople(); // acting coach

  // Revalidate player
  const player = await peopleRepository.findById(playerId);
  if (!player || !player.active) {
    throw new Error('Player not found or inactive');
  }
  if (!player.registeredTeam || !player.playingPosition || !player.playingAbility) {
    throw new Error('Player profile is incomplete');
  }
  if (player.isSuspended || (player.matchesToServe && player.matchesToServe > 0)) {
    throw new Error('Player is suspended');
  }

  const match = await matchesRepository.findById(matchId);
  if (!match) throw new Error('Match not found');

  // Team rank checks
  const ref = await getClubReferenceData();
  const teamRankMap = ref.teamRankMap;
  const home = match.homeTeam || '';
  const away = match.awayTeam || '';
  const hkfcTeam = teamRankMap[home] !== undefined ? home : away;
  const targetTeamRank = teamRankMap[hkfcTeam] || 99;
  const playerTeamRank = teamRankMap[player.registeredTeam || ''] || 99;
  if (playerTeamRank < targetTeamRank) {
    throw new Error('Higher-to-lower movement blocked (7.2a)');
  }
  if (player.isVisitingPlayer && player.registeredTeam !== hkfcTeam) {
    throw new Error('Visiting player fixed to registered team (6.4)');
  }

  // Check duplicate
  const allSelections = await selectionsRepository.findAll({});
  const existing = allSelections.find(s => {
    const pId = Array.isArray(s.player) ? s.player[0] : s.player;
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return pId === playerId && mId === matchId;
  });
  if (existing) {
    throw new Error('Player already selected for this match');
  }

  // Create selection
  const result = await selectionsRepository.create({
    match: matchId,
    player: playerId,
    selectionStatus,
    selectedBy: user.id,
    selectedAt: new Date().toISOString(),
  });

  return { id: result.id, success: true };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\api\setAvailability.ts

import { peopleRepository, availabilityRepository } from '@/repositories';

export async function setAvailability(
  playerId: string,
  matchIds: string[],
  status: 'Available' | 'Maybe' | 'Unavailable',
  notes?: string
) {
  const player = await peopleRepository.findById(playerId);
  if (!player || !player.active) {
    throw new Error('Player not found or inactive');
  }

  const allExceptions = await availabilityRepository.findAll({});
  const playerExceptions = allExceptions.filter(e => {
    const pId = Array.isArray(e.player) ? e.player[0] : e.player;
    return pId === playerId;
  });
  const exceptionByMatch = new Map(playerExceptions.map(e => {
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return [mId || '', e];
  }));

  let updated = 0;

  for (const matchId of matchIds) {
    const existing = exceptionByMatch.get(matchId);
    if (status === 'Available') {
      if (existing) {
        await availabilityRepository.delete(existing.id);
        updated++;
      }
    } else if (existing) {
      await availabilityRepository.update(existing.id, {
        availabilityStatus: status,
        playerNotes: notes || '',
        updatedBy: playerId,
      });
      updated++;
    } else {
      await availabilityRepository.create({
        match: matchId,
        player: playerId,
        availabilityStatus: status,
        playerNotes: notes || '',
        updatedBy: playerId,
      });
      updated++;
    }
  }

  return { success: true, updated };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\api\setMyAvailability.ts

import { availabilityRepository } from '@/repositories';
import { getCurrentPeople } from '@/lib/auth';

export async function setMyAvailability(
  matchId: string,
  status: 'Available' | 'Maybe' | 'Unavailable',
  notes?: string,
  existingExceptionId?: string
) {
  const user = await getCurrentPeople();

  if (status === 'Available') {
    if (existingExceptionId) {
      await availabilityRepository.delete(existingExceptionId);
    }
  } else if (existingExceptionId) {
    await availabilityRepository.update(existingExceptionId, {
      availabilityStatus: status,
      playerNotes: notes || '',
      updatedBy: user.id,
    });
  } else {
    await availabilityRepository.create({
      match: matchId,
      player: user.id,
      availabilityStatus: status,
      playerNotes: notes || '',
      updatedBy: user.id,
    });
  }

  return { success: true };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\AppHeader.tsx

import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProfileData } from '@/api/getMyProfile';

export default function AppHeader({ profile }: { profile: ProfileData }) {
  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };
  const navigate = useNavigate();
  const teamNames = profile.coachedTeams.map(t => t.teamName).join(', ');

  return (
    <header className="w-full border-b border-border bg-card">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold text-foreground">HKFC Squad Selection</p>
          <p className="text-sm text-muted-foreground">
            {teamNames ? `Coaching: ${teamNames}` : 'No teams assigned'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <User className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Player</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            <LogOut className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\AvailabilitySheet.tsx

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { setAvailability } from '@/api/setAvailability';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, HelpCircle, XCircle, Loader2 } from 'lucide-react';

type Fixture = {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  availabilityStatus: string;
  playerNotes: string;
};

const OPTIONS = [
  { value: 'Available', label: 'Available', desc: 'Default — no exception recorded', Icon: CheckCircle2 },
  { value: 'Maybe', label: 'Maybe', desc: 'Uncertain — coach will see this status', Icon: HelpCircle },
  { value: 'Unavailable', label: 'Unavailable', desc: 'Cannot play this fixture', Icon: XCircle },
] as const;

export default function AvailabilitySheet({
  fixture, playerId, onClose, onSaved,
}: {
  fixture: Fixture; playerId: string; onClose: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState<string>(fixture.availabilityStatus);
  const [notes, setNotes] = useState(fixture.playerNotes);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setAvailability(
        playerId,
        [fixture.id],
        status as 'Available' | 'Maybe' | 'Unavailable',
        notes
      );
      toast.success('Availability updated');
      onSaved();
    } catch {
      toast.error('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const d = parseISO(fixture.date);

  return (
    <Sheet open onOpenChange={() => onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Update Availability</SheetTitle>
        </SheetHeader>
        <div className="py-2">
          <p className="text-sm font-medium text-foreground">{fixture.homeTeam} vs {fixture.awayTeam}</p>
          <p className="text-xs text-muted-foreground">{format(d, 'EEE d MMM')} · {format(d, 'HH:mm')} · {fixture.venue}</p>
        </div>

        <div className="space-y-2 py-3">
          {OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatus(opt.value)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left ${
                status === opt.value ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <opt.Icon className={`h-5 w-5 ${status === opt.value ? 'text-primary' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-medium text-foreground">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="py-2">
          <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder='e.g. "Arriving late from work"'
            className="mt-1"
            rows={2}
          />
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full mt-3">
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Save
        </Button>
      </SheetContent>
    </Sheet>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\BulkActionBar.tsx

import { useState } from 'react';
import { selectPlayer } from '@/api/selectPlayer';
import { removeSelection } from '@/api/removeSelection';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export default function BulkActionBar({
  count, playerIds, matchId, onDone,
}: {
  count: number; playerIds: string[]; matchId: string; onDone: () => void;
}) {
  const [acting, setActing] = useState(false);

  const handleBulkReserve = async () => {
    setActing(true);
    let ok = 0;
    for (const pid of playerIds) {
      try {
        await selectPlayer(matchId, pid, 'Reserve');
        ok++;
      } catch { /* skip failures */ }
    }
    toast.success(`${ok} player${ok !== 1 ? 's' : ''} marked as reserve`);
    setActing(false);
    onDone();
  };

  const handleBulkRemove = async () => {
    // This would need selection IDs — for now show a message
    toast.info('To bulk remove, deselect players individually');
    onDone();
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <p className="text-sm text-foreground font-medium">{count} checked</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleBulkReserve} disabled={acting}>
            {acting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Mark Reserve
          </Button>
          <Button variant="destructive" size="sm" onClick={handleBulkRemove} disabled={acting}>
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\CoachLayout.tsx

import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/useAuth';
import { getMyProfile, ProfileData } from '@/api/getMyProfile';
import { Skeleton } from '@/components/ui/skeleton';
import AppHeader from '@/components/AppHeader';

export default function CoachLayout() {
  const { user, isLoading } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getMyProfile().then(data => {
      setProfile(data);
      setProfileLoading(false);
    }).catch(() => setProfileLoading(false));
  }, [user]);

  if (isLoading || !user) {
    return <LoadingSkeleton />;
  }
  if (profileLoading) {
    return <LoadingSkeleton />;
  }
  if (!profile?.isCoach) {
    return <NotCoach />;
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader profile={profile} />
      <Outlet context={{ profile }} />
    </div>
  );
}

function NotCoach() {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-6">
      <div className="text-center space-y-3">
        <p className="text-lg font-semibold text-foreground">Coach Access Required</p>
        <p className="text-sm text-muted-foreground">You don't have coach permissions.</p>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-primary underline"
        >
          Go to Player Dashboard
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background p-6 space-y-4">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-6 w-32" />
      <div className="space-y-3 pt-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\FixtureCard.tsx

import { format, parseISO } from 'date-fns';
import { useNavigate } from 'react-router-dom';

type Fixture = {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  division: string;
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
  reserveCount: number;
  maybeCount: number;
  unavailableCount: number;
};

export default function FixtureCard({ fixture }: { fixture: Fixture }) {
  const navigate = useNavigate();
  const d = parseISO(fixture.date);
  const time = format(d, 'HH:mm');
  const shortfall = fixture.targetSquadSize - fixture.selectedCount;
  const isFull = shortfall <= 0;

  return (
    <button
      onClick={() => navigate(`/coach/match/${fixture.id}`)}
      className="w-full border border-border rounded-lg p-4 text-left hover:bg-muted/50 transition-colors"
    >
      <div className="flex justify-between items-start">
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">
            {fixture.homeTeam} vs {fixture.awayTeam}
          </p>
          <p className="text-sm text-muted-foreground">
            {fixture.division} · {fixture.venue} · {time}
          </p>
        </div>
        <div className="text-right shrink-0 ml-3">
          <span className={`inline-flex items-center px-2 py-1 rounded-md text-sm font-medium ${
            isFull ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>
            {fixture.selectedCount} / {fixture.targetSquadSize}
          </span>
          {shortfall > 0 && (
            <p className="text-xs text-destructive font-medium mt-1">{shortfall} short</p>
          )}
        </div>
      </div>
      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
        <span>{fixture.maybeCount} maybe</span>
        <span>{fixture.unavailableCount} unavail</span>
        {fixture.reserveCount > 0 && <span>{fixture.reserveCount} reserve</span>}
      </div>
    </button>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\MatchHeader.tsx

import { format, parseISO } from 'date-fns';

type MatchInfo = {
  date: string;
  homeTeam: string;
  awayTeam: string;
  division: string;
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
  reserveCount: number;
};

export default function MatchHeader({ match }: { match: MatchInfo }) {
  const d = parseISO(match.date);
  const stats = [
    { label: 'Selected', value: match.selectedCount },
    { label: 'Reserves', value: match.reserveCount },
    { label: 'Target', value: match.targetSquadSize },
  ];

  return (
    <div className="border-b border-border bg-card">
      <div className="container mx-auto px-4 py-2">
        <p className="text-sm font-medium text-foreground">
          {match.homeTeam} vs {match.awayTeam}
        </p>
        <p className="text-xs text-muted-foreground">
          {format(d, 'EEE d MMM')} · {format(d, 'HH:mm')} · {match.venue} · {match.division}
        </p>
      </div>
      <div className="container mx-auto px-4 pb-3 grid grid-cols-3 gap-2 text-center">
        {stats.map(s => (
          <div key={s.label} className="bg-muted rounded-md py-2">
            <p className="text-lg font-bold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\PlayerAvailabilitySheet.tsx

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { setMyAvailability } from '@/api/setMyAvailability';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, HelpCircle, XCircle, Loader2 } from 'lucide-react';

type Fixture = {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  availabilityStatus: string;
  playerNotes: string;
  availabilityExceptionId: string;
  selectionStatus: string;
};

const OPTIONS = [
  { value: 'Available', label: 'Available', desc: 'I can play', Icon: CheckCircle2 },
  { value: 'Maybe', label: 'Maybe', desc: 'Uncertain — coach will see this', Icon: HelpCircle },
  { value: 'Unavailable', label: 'Unavailable', desc: 'Cannot play this match', Icon: XCircle },
] as const;

export default function PlayerAvailabilitySheet({
  fixture, onClose, onSaved,
}: {
  fixture: Fixture; onClose: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState<string>(fixture.availabilityStatus);
  const [notes, setNotes] = useState(fixture.playerNotes);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setMyAvailability(
        fixture.id,
        status as 'Available' | 'Maybe' | 'Unavailable',
        notes,
        fixture.availabilityExceptionId || undefined
      );
      toast.success('Availability updated');
      onSaved();
    } catch {
      toast.error('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const d = parseISO(fixture.date);

  return (
    <Sheet open onOpenChange={() => onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Update Availability</SheetTitle>
        </SheetHeader>
        <div className="py-2">
          <p className="text-sm font-medium text-foreground">{fixture.homeTeam} vs {fixture.awayTeam}</p>
          <p className="text-xs text-muted-foreground">
            {format(d, 'EEE d MMM')} · {format(d, 'HH:mm')} · {fixture.venue}
          </p>
          {fixture.selectionStatus && (
            <p className="text-xs font-medium text-primary mt-1">
              You are currently: {fixture.selectionStatus}
            </p>
          )}
        </div>

        <div className="space-y-2 py-3">
          {OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatus(opt.value)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left ${
                status === opt.value ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <opt.Icon className={`h-5 w-5 ${status === opt.value ? 'text-primary' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-medium text-foreground">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="py-2">
          <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder='e.g. "Arriving late from work"'
            className="mt-1"
            rows={2}
          />
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full mt-3">
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Save
        </Button>
      </SheetContent>
    </Sheet>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\PlayerFilters.tsx

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'eligible', label: 'Eligible' },
  { key: 'selected', label: 'Selected' },
  { key: 'DEF', label: 'Defenders' },
  { key: 'MID', label: 'Midfield' },
  { key: 'FWD', label: 'Forward' },
  { key: 'GK', label: 'GK' },
];

export default function PlayerFilters({ active, onFilter }: { active: string; onFilter: (f: string) => void }) {
  return (
    <div className="border-b border-border overflow-x-auto">
      <div className="container mx-auto px-4 py-2 flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => onFilter(f.key)}
            className={`text-xs px-3 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
              active === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\PlayerFixtureCard.tsx

import { format, parseISO } from 'date-fns';
import { MapPin, Calendar, CheckCircle2, Clock, XCircle, HelpCircle, Users } from 'lucide-react';

type Fixture = {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  division: string;
  availabilityStatus: string;
  playerNotes: string;
  selectionStatus: string;
  selectionNotes: string;
  selectedCount: number;
  targetSquadSize: number;
};

export default function PlayerFixtureCard({ fixture, onTap }: { fixture: Fixture; onTap: () => void }) {
  const d = parseISO(fixture.date);
  const isSelected = fixture.selectionStatus === 'Selected';
  const isReserve = fixture.selectionStatus === 'Reserve';
  const isUnavailable = fixture.availabilityStatus === 'Unavailable';
  const isMaybe = fixture.availabilityStatus === 'Maybe';

  return (
    <button
      onClick={onTap}
      className={`w-full border rounded-xl p-4 text-left transition-all hover:shadow-sm ${
        isSelected
          ? 'border-primary bg-primary/5'
          : isReserve
          ? 'border-accent bg-accent/30'
          : isUnavailable
          ? 'border-border bg-muted/30 opacity-60'
          : 'border-border bg-card'
      }`}
    >
      {/* Top row: teams + selection badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-foreground">
            {fixture.isHome ? fixture.hkfcTeam : fixture.opponent}
            <span className="text-muted-foreground font-normal"> vs </span>
            {fixture.isHome ? fixture.opponent : fixture.hkfcTeam}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{fixture.division}</p>
        </div>
        <SelectionBadge status={fixture.selectionStatus} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 mt-2.5 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {format(d, 'EEE d MMM')}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {format(d, 'HH:mm')}
        </span>
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {fixture.venue}
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {fixture.selectedCount}/{fixture.targetSquadSize}
        </span>
      </div>

      {/* Availability + notes */}
      <div className="flex items-center gap-2 mt-2.5">
        <AvailabilityIndicator status={fixture.availabilityStatus} />
        {fixture.playerNotes && (
          <span className="text-xs text-muted-foreground italic truncate">
            "{fixture.playerNotes}"
          </span>
        )}
      </div>

      {fixture.selectionNotes && (
        <p className="text-xs text-primary mt-1.5">Coach: {fixture.selectionNotes}</p>
      )}
    </button>
  );
}

function SelectionBadge({ status }: { status: string }) {
  if (status === 'Selected') {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground shrink-0">
        <CheckCircle2 className="h-3 w-3" /> Selected
      </span>
    );
  }
  if (status === 'Reserve') {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground shrink-0">
        Reserve
      </span>
    );
  }
  return null;
}

function AvailabilityIndicator({ status }: { status: string }) {
  if (status === 'Unavailable') {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <XCircle className="h-3 w-3" /> Unavailable
      </span>
    );
  }
  if (status === 'Maybe') {
    return (
      <span className="flex items-center gap-1 text-xs text-secondary-foreground">
        <HelpCircle className="h-3 w-3" /> Maybe
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <CheckCircle2 className="h-3 w-3" /> Available
    </span>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\PlayerRow.tsx

import { useState } from 'react';
import { CheckCircle2, Circle, Ban, AlertTriangle, Loader2 } from 'lucide-react';
import {  selectPlayer } from '@/api/selectPlayer';
import { removeSelection } from '@/api/removeSelection';
import { toast } from 'sonner';

type Player = {
  id: string;
  preferredName: string;
  registeredTeam: string;
  playingPosition: string;
  playingAbility: string;
  availabilityStatus: string;
  playerNotes: string;
  playUpCount: number;
  eligibilityStatus: string;
  blocks: { rule: string; reason: string }[];
  warnings: { rule: string; reason: string }[];
  conflicts: { type: string; team: string; matchId: string }[];
  selectionStatus: string;
  selectionId: string;
};

const POS_SHORT: Record<string, string> = {
  Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD', Goalkeeper: 'GK', 'Flexible/Varies': 'FLEX',
};

export default function PlayerRow({
  player, matchId, checked, onToggleCheck, onRefresh,
}: {
  player: Player; matchId: string; checked: boolean;
  onToggleCheck: () => void; onRefresh: () => void;
}) {
  const [acting, setActing] = useState(false);
  const isBlocked = player.eligibilityStatus === 'blocked';
  const isSelected = !!player.selectionStatus;
  const isUnavailable = player.availabilityStatus === 'Unavailable';
  const dimmed = isBlocked || isUnavailable;

  const handleTap = async () => {
    if (isBlocked || acting) return;
    setActing(true);
    try {
      if (isSelected) {
        await removeSelection(player.selectionId);
        toast.success(`${player.preferredName} removed`);
      } else {
        await selectPlayer(matchId, player.id, 'Selected');
        toast.success(`${player.preferredName} selected`);
      }
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message || 'Action failed');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className={`flex items-center gap-3 py-3 border-b border-border ${dimmed ? 'opacity-50' : ''}`}>
      {/* Checkbox for bulk */}
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCheck}
        className="h-4 w-4 shrink-0 accent-primary"
        disabled={isBlocked}
      />

      {/* Status icon */}
      <button onClick={handleTap} disabled={isBlocked || acting} className="shrink-0">
        {acting ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> :
         isSelected ? <CheckCircle2 className="h-5 w-5 text-primary" /> :
         isBlocked ? <Ban className="h-5 w-5 text-muted-foreground" /> :
         <Circle className="h-5 w-5 text-muted-foreground" />}
      </button>

      {/* Player info */}
      <div className="flex-1 min-w-0" onClick={handleTap}>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">{player.preferredName}</p>
          <span className="text-xs text-muted-foreground shrink-0">
            {POS_SHORT[player.playingPosition] || '—'} · {player.playingAbility || '—'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {player.registeredTeam || '—'} · {player.playUpCount} play-up{player.playUpCount !== 1 ? 's' : ''} · {player.availabilityStatus}
        </p>

        {/* Player notes */}
        {player.playerNotes && (
          <p className="text-xs text-muted-foreground mt-0.5 italic truncate">"{player.playerNotes}"</p>
        )}

        {/* Conflicts */}
        {player.conflicts.map((c, i) => (
          <span key={i} className="text-xs bg-accent text-accent-foreground rounded px-1 py-0.5 inline-block mt-1 mr-1">
            {c.type === 'reserve' ? 'Reserve' : 'Selected'}: {c.team}
          </span>
        ))}

        {/* Warnings */}
        {player.warnings.map((w, i) => (
          <span key={i} className="text-xs bg-secondary text-secondary-foreground rounded px-1 py-0.5 inline-block mt-1 mr-1">
            ⚠ {w.reason}
          </span>
        ))}

        {/* Blocks */}
        {player.blocks.map((b, i) => (
          <span key={i} className="text-xs bg-destructive text-destructive-foreground rounded px-1 py-0.5 inline-block mt-1 mr-1">
            {b.reason}
          </span>
        ))}
      </div>

      {/* Selection badge */}
      {isSelected && (
        <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${
          player.selectionStatus === 'Reserve'
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary text-primary-foreground'
        }`}>
          {player.selectionStatus}
        </span>
      )}
    </div>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\ui\button.tsx

import React from 'react';

type Props =
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  };

export function Button({
  className = '',
  ...props
}: Props) {
  return (
    <button
      className={`px-3 py-2 rounded border ${className}`}
      {...props}
    />
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\ui\sheet.tsx

import React from 'react';

export function Sheet({
  children
}: any) {
  return <>{children}</>;
}

export function SheetContent({
  children
}: any) {
  return (
    <div className="fixed right-0 top-0 h-full w-full max-w-md bg-background border-l p-4 overflow-auto">
      {children}
    </div>
  );
}

export function SheetHeader({
  children
}: any) {
  return <div className="mb-4">{children}</div>;
}

export function SheetTitle({
  children
}: any) {
  return (
    <h2 className="font-semibold text-lg">
      {children}
    </h2>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\ui\skeleton.tsx

export function Skeleton({
  className = ''
}: {
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse bg-muted rounded ${className}`}
    />
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\ui\sonner.tsx

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return <Sonner richColors position="top-center" />;
}

### C:\dev\Hockey Trials App\Squad-Selection\src\components\ui\textarea.tsx

import React from 'react';

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  return (
    <textarea
      className="w-full border rounded p-2"
      {...props}
    />
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\generated\domainTypes.ts

export interface Player {
  id: string;
  preferredName?: string;
  givenNames?: string;
  surname?: string;
  shirtNoValue?: string;
  email?: string;
  active?: boolean;
  registeredTeam?: string;
  playingPosition?: string;
  playingAbility?: string;
  isVisitingPlayer?: boolean;
  isSuspended?: boolean;
  matchesToServe?: number;
  everRegisteredToPremier?: string;
  playerCoach?: string[];
}

export interface Team {
  id: string;
  teamName?: string;
  teamRank?: number;
  isPremier?: boolean;
  targetSquadSize?: number;
  active?: boolean;
  coach?: string[];
  teamCaptain?: string[];
  sectionCaptain?: string[];
}

export interface Match {
  id: string;
  matchDate: string,
  division: string,
  homeTeam: string,
  homeTeamScore: number,
  awayTeam: string,
  awayTeamScore: number,
  matchStatus: string,
  venue?: string;
}

export interface SquadSelection {
  id: string;
  player?: string[];
  match?: string[];
  selectedBy?: string[];
  selectedAt?: string;
  selectionStatus?: string;
  selectionNotes?: string;
}

export interface AvailabilityException {
  id: string;
  player?: string[];
  match?: string[];
  availabilityStatus?: string;
  note?: string;
}

export interface MatchCard {
  id: string;
  player?: string[];
  match?: string[];
  goals?: number;
  cards?: string[];
}

### C:\dev\Hockey Trials App\Squad-Selection\src\generated\fieldMaps.ts

export const PEOPLE_FIELDS = {
  preferredName: "Preferred Name",
  givenNames: "Given Name(s)",
  surname: "Surname",
  shirtNoValue: "Shirt No Value",
  email: "Email",
  active: "Active",
  registeredTeam: "Registered Team",
  playingPosition: "Playing Position",
  playingAbility: "Playing Ability",
  isVisitingPlayer: "Is Visiting Player",
  isSuspended: "Is Suspended",
  matchesToServe: "Matches To Serve",
  everRegisteredToPremier: "Ever Registered To Premier",
  playerCoach: "Player/Coach",
} as const;

export const TEAMS_FIELDS = {
  teamName: "Team Name",
  teamRank: "Team Rank",
  isPremier: "Is Premier",
  targetSquadSize: "Target Squad Size",
  active: "Active",
  coach: "Coach",
  teamCaptain: "Team Captain",
  sectionCaptain: "Section Captain",
} as const;

export const MATCHES_FIELDS = {
  matchDate: "Date",
  division: "Division",
  homeTeam: "Home Team",
  homeTeamScore: "Home Score",
  awayTeam: "Away Team",
  awayTeamScore: "Away Score",
  matchStatus: "Match Status",
  venue: "Venue",
} as const;

export const SQUADSELECTIONS_FIELDS = {
  player: "Player",
  match: "Match",
  selectedBy: "Selected By",
  selectedAt: "Selected At",
  selectionStatus: "Selection Status",
  selectionNotes: "Selection Notes",
} as const;

export const AVAILABILITYEXCEPTIONS_FIELDS = {
  player: "Player",
  match: "Match",
  availabilityStatus: "Availability Status",
  note: "Player Notes",
} as const;

export const MATCHCARDS_FIELDS = {
  player: "Player",
  match: "Match",
  goals: "Goals Scored",
  cards: "Cards",
} as const;

### C:\dev\Hockey Trials App\Squad-Selection\src\generated\tableNames.ts

export const TABLES = {
  player: "People",
  team: "Teams",
  match: "Matches",
  squadSelection: "Squad Selections",
  availabilityException: "Availability Exceptions",
  matchCard: "Match Cards",
} as const;

### C:\dev\Hockey Trials App\Squad-Selection\src\lib\auth.ts

import { supabase } from './supabase';
import { peopleRepository } from '@/repositories/peopleRepository';

/**
 * Get the current authenticated Supabase user.
 * Returns null if not logged in.
 */
export async function getCurrentSupabaseUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Get the People record linked to the current Supabase user via email.
 * Throws if not found.
 */
export async function getCurrentPeople() {
  const user = await getCurrentSupabaseUser();
  if (!user) throw new Error('Not authenticated');
  if (!user.email) throw new Error('User has no email address');

  const people = await peopleRepository.getByEmail(user.email);
  if (!people) throw new Error('Player record not found for this email');

  return people;
}

### C:\dev\Hockey Trials App\Squad-Selection\src\lib\cache.ts

// In-memory cache for Cloudflare Worker isolate.
// Data persists within a single isolate's lifetime and is refreshed after TTL.
// Multiple concurrent requests in the same isolate share the cache.

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<any>>();

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<{ data: T; fromCache: boolean }> {
  const now = Date.now();
  const existing = store.get(key);

  if (existing && existing.expiresAt > now) {
    return { data: existing.data as T, fromCache: true };
  }

  const data = await fetcher();
  store.set(key, { data, expiresAt: now + ttlMs });
  return { data, fromCache: false };
}

export function invalidateCache(key: string) {
  store.delete(key);
}

export function invalidateAll() {
  store.clear();
}

### C:\dev\Hockey Trials App\Squad-Selection\src\lib\supabase.ts

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

### C:\dev\Hockey Trials App\Squad-Selection\src\lib\useAuth.ts

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => listener?.subscription.unsubscribe();
  }, []);

  const loginWithEmail = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return { user, isLoading: loading, loginWithEmail, logout };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\mappers\availabilityMapper.ts

import { AvailabilityException } from '@/generated/domainTypes';
import { AVAILABILITYEXCEPTIONS_FIELDS } from '@/generated/fieldMaps';

export function mapAvailability(record: any): AvailabilityException {
  const f = record.fields;
  return {
    id: record.id,
    player: f[AVAILABILITYEXCEPTIONS_FIELDS.player] || [],
    match: f[AVAILABILITYEXCEPTIONS_FIELDS.match] || [],
    availabilityStatus: f[AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus] || '',
    note: f[AVAILABILITYEXCEPTIONS_FIELDS.note] || '',
  };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\mappers\matchCardMapper.ts

import {
  MatchCard
} from "../generated/domainTypes";

import {
  MATCHCARDS_FIELDS
} from "../generated/fieldMaps";

export function mapMatchCard(
  record: any
): MatchCard {

  const f = record.fields;

  return {
    id: record.id,

    player:
      f[MATCHCARDS_FIELDS.player],

    match:
      f[MATCHCARDS_FIELDS.match],

    goals:
      f[MATCHCARDS_FIELDS.goals],

    cards:
      f[MATCHCARDS_FIELDS.cards]
  };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\mappers\matchMapper.ts

import { Match } from '@/generated/domainTypes';
import { MATCHES_FIELDS } from '@/generated/fieldMaps';

export function mapMatch(record: any): Match {
  const f = record.fields;
  return {
    id: record.id,
    matchDate: f[MATCHES_FIELDS.matchDate] || '',
    division: f[MATCHES_FIELDS.division] || '',
    homeTeam: f[MATCHES_FIELDS.homeTeam] || '',
    homeTeamScore: f[MATCHES_FIELDS.homeTeamScore] || 0,
    awayTeam: f[MATCHES_FIELDS.awayTeam] || '',
    awayTeamScore: f[MATCHES_FIELDS.awayTeamScore] || 0,
    matchStatus: f[MATCHES_FIELDS.matchStatus] || '',
    venue: f[MATCHES_FIELDS.venue] || '',
  };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\mappers\playerMapper.ts

import { Player } from "../generated/domainTypes";
import { PEOPLE_FIELDS } from "../generated/fieldMaps";

export function mapPlayer(
  record: any
): Player {

  const f = record.fields;

  return {
    id: record.id,

    preferredName:
      f[PEOPLE_FIELDS.preferredName],

    givenNames:
      f[PEOPLE_FIELDS.givenNames],

    surname:
      f[PEOPLE_FIELDS.surname],

    shirtNoValue:
      f[PEOPLE_FIELDS.shirtNoValue],

    email:
      f[PEOPLE_FIELDS.email],

    active:
      f[PEOPLE_FIELDS.active],

    registeredTeam:
      f[PEOPLE_FIELDS.registeredTeam],

    playingPosition:
      f[PEOPLE_FIELDS.playingPosition],

    playingAbility:
      f[PEOPLE_FIELDS.playingAbility],

    isSuspended:
      f[PEOPLE_FIELDS.isSuspended],

    matchesToServe:
      f[PEOPLE_FIELDS.matchesToServe],

    isVisitingPlayer:
      f[PEOPLE_FIELDS.isVisitingPlayer],

    everRegisteredToPremier:
      f[
        PEOPLE_FIELDS
          .everRegisteredToPremier
      ],

    playerCoach:
      f[PEOPLE_FIELDS.playerCoach]
  };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\mappers\selectionMapper.ts

import { SquadSelection } from '@/generated/domainTypes';
import { SQUADSELECTIONS_FIELDS } from '@/generated/fieldMaps';

export function mapSelection(record: any): SquadSelection {
  const f = record.fields;
  return {
    id: record.id,
    player: f[SQUADSELECTIONS_FIELDS.player] || [],
    match: f[SQUADSELECTIONS_FIELDS.match] || [],
    selectedBy: f[SQUADSELECTIONS_FIELDS.selectedBy] || [],
    selectedAt: f[SQUADSELECTIONS_FIELDS.selectedAt] || '',
    selectionStatus: f[SQUADSELECTIONS_FIELDS.selectionStatus] || '',
    selectionNotes: f[SQUADSELECTIONS_FIELDS.selectionNotes] || '',
  };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\mappers\teamMapper.ts

import { Team } from '@/generated/domainTypes';
import { TEAMS_FIELDS } from '@/generated/fieldMaps';

export function mapTeam(record: any): Team {
  const f = record.fields;
  return {
    id: record.id,
    teamName: f[TEAMS_FIELDS.teamName] || '',
    teamRank: f[TEAMS_FIELDS.teamRank] || 99,
    isPremier: f[TEAMS_FIELDS.isPremier] || false,
    targetSquadSize: f[TEAMS_FIELDS.targetSquadSize] || 16,
    active: f[TEAMS_FIELDS.active] || false,
    coach: Array.isArray(f[TEAMS_FIELDS.coach]) ? f[TEAMS_FIELDS.coach] : (f[TEAMS_FIELDS.coach] ? [f[TEAMS_FIELDS.coach]] : []),
    teamCaptain: Array.isArray(f[TEAMS_FIELDS.teamCaptain]) ? f[TEAMS_FIELDS.teamCaptain] : (f[TEAMS_FIELDS.teamCaptain] ? [f[TEAMS_FIELDS.teamCaptain]] : []),
    sectionCaptain: Array.isArray(f[TEAMS_FIELDS.sectionCaptain]) ? f[TEAMS_FIELDS.sectionCaptain] : (f[TEAMS_FIELDS.sectionCaptain] ? [f[TEAMS_FIELDS.sectionCaptain]] : []),
  };
}

### C:\dev\Hockey Trials App\Squad-Selection\src\pages\FixtureList.tsx

import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { getUpcomingFixtures, GetUpcomingFixturesOutput } from '@/api/getUpcomingFixtures';
import { Skeleton } from '@/components/ui/skeleton';
import FixtureCard from '@/components/FixtureCard';
import type { ProfileData } from '@/api/getMyProfile';

type Fixture = GetUpcomingFixturesOutput['fixtures'][0];

export default function FixtureList() {
  const { profile } = useOutletContext<{ profile: ProfileData }>();
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    const filter = activeTab === 'all' ? undefined : activeTab;
    setLoading(true);
    getUpcomingFixtures(filter)
      .then(data => setFixtures(data.fixtures))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTab]);

  const tabs = [
    { key: 'all', label: 'All' },
    ...profile.coachedTeams.map(t => ({ key: t.teamName, label: t.teamName })),
  ];

  // Group fixtures by date
  const grouped = fixtures.reduce<Record<string, Fixture[]>>((acc, f) => {
    const dateKey = format(parseISO(f.date), 'yyyy-MM-dd');
    (acc[dateKey] ||= []).push(f);
    return acc;
  }, {});
  const sortedDates = Object.keys(grouped).sort();

  return (
    <div className="container mx-auto px-4 pb-8">
      {/* Team filter tabs */}
      {tabs.length > 2 && (
        <div className="flex gap-4 border-b border-border py-2 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`text-sm pb-2 whitespace-nowrap shrink-0 ${
                activeTab === t.key
                  ? 'font-medium text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3 pt-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      ) : fixtures.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No upcoming fixtures found</p>
        </div>
      ) : (
        <div className="pt-4 space-y-4">
          {sortedDates.map(dateKey => (
            <div key={dateKey}>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                {format(parseISO(dateKey), 'EEE d MMM yyyy')}
              </p>
              <div className="space-y-2">
                {grouped[dateKey].map(f => (
                  <FixtureCard key={f.id} fixture={f} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\pages\Login.tsx

import { useState } from 'react';
import { useAuth } from '@/lib/useAuth';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginWithEmail, user } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in
  if (user) {
    navigate('/');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await loginWithEmail(email);
      toast.success('Magic link sent! Check your email.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-card p-6 rounded-lg border border-border">
        <h1 className="text-2xl font-bold text-foreground mb-6">HKFC Hockey</h1>
        <p className="text-muted-foreground mb-6">Enter your email to receive a magic link</p>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            className="w-full p-2 border border-border rounded mb-4 bg-background text-foreground"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground py-2 rounded hover:bg-primary/90 transition-colors"
          >
            {loading ? 'Sending...' : 'Send Magic Link'}
          </button>
        </form>
      </div>
    </div>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\pages\PlayerDashboard.tsx

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/useAuth';
import { getMyFixtures, GetMyFixturesOutput } from '@/api/getMyFixtures';
import { Skeleton } from '@/components/ui/skeleton';
import { LogOut, Shield } from 'lucide-react';
import PlayerFixtureCard from '@/components/PlayerFixtureCard';
import PlayerAvailabilitySheet from '@/components/PlayerAvailabilitySheet';

type Fixture = GetMyFixturesOutput['fixtures'][0];

export default function PlayerDashboard() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<GetMyFixturesOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);

  const loadData = useCallback(() => {
    if (!user) return;
    setLoading(true);
    getMyFixtures()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  if (isLoading || !user) {
    return <DashboardSkeleton />;
  }

  if (loading || !data) {
    return <DashboardSkeleton />;
  }

  // Count stats
  const selectedCount = data.fixtures.filter(f => f.selectionStatus === 'Selected').length;
  const reserveCount = data.fixtures.filter(f => f.selectionStatus === 'Reserve').length;
  const unavailableCount = data.fixtures.filter(f => f.availabilityStatus === 'Unavailable').length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-foreground">HKFC Hockey</h1>
              <p className="text-sm text-muted-foreground">Squad Selection</p>
            </div>
            <div className="flex items-center gap-2">
              {data.isCoach && (
                <button
                  onClick={() => navigate('/coach')}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Coach View
                </button>
              )}
              <button
                onClick={() => logout()}
                className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Player Info Card */}
      <div className="container mx-auto px-4 py-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-lg font-bold text-primary">
                {(data.playerName || '?')[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground">{data.playerName}</p>
              <p className="text-sm text-muted-foreground">
                {data.registeredTeam || 'No team'}{data.playingPosition ? ` · ${data.playingPosition}` : ''}{data.shirtNoValue ? ` · #${data.shirtNoValue}` : ''}
              </p>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <StatBox label="Selected" value={selectedCount} color="bg-primary/10 text-primary" />
            <StatBox label="Reserve" value={reserveCount} color="bg-accent text-accent-foreground" />
            <StatBox label="Unavailable" value={unavailableCount} color="bg-destructive/10 text-destructive" />
          </div>
        </div>
      </div>

      {/* Fixtures List */}
      <div className="container mx-auto px-4 pb-8">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Upcoming Fixtures ({data.fixtures.length})
        </h2>

        {data.fixtures.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground">No upcoming fixtures for your team</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.fixtures.map(f => (
              <PlayerFixtureCard
                key={f.id}
                fixture={f}
                onTap={() => setSelectedFixture(f)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedFixture && (
        <PlayerAvailabilitySheet
          fixture={selectedFixture}
          onClose={() => setSelectedFixture(null)}
          onSaved={() => { setSelectedFixture(null); loadData(); }}
        />
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg p-3 text-center ${color}`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs mt-0.5">{label}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-4 py-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-24 mt-1" />
      </div>
      <div className="container mx-auto px-4 py-4 space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\pages\PlayerFixtures.tsx

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { getPlayerFixtures, GetPlayerFixturesOutput } from '@/api/getPlayerFixtures';
import { Skeleton } from '@/components/ui/skeleton';
import AvailabilitySheet from '@/components/AvailabilitySheet';

type Fixture = GetPlayerFixturesOutput['fixtures'][0];

export default function PlayerFixtures() {
  const { playerId } = useParams<{ playerId: string }>();
  const [data, setData] = useState<GetPlayerFixturesOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);

  const loadData = useCallback(() => {
    if (!playerId) return;
    setLoading(true);
    getPlayerFixtures(playerId)
      .then(setData)
      .catch(() => setError('Player not found or inactive'))
      .finally(() => setLoading(false));
  }, [playerId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-32" />
        {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <p className="text-muted-foreground">{error || 'Something went wrong'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <p className="text-lg font-semibold text-foreground">My Fixtures</p>
          <p className="text-sm text-muted-foreground">{data.playerName} · {data.registeredTeam}</p>
        </div>
      </header>

      <div className="container mx-auto px-4 py-4 space-y-2">
        {data.fixtures.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No upcoming fixtures</p>
        ) : (
          data.fixtures.map(f => (
            <FixtureRow key={f.id} fixture={f} onTap={() => setSelectedFixture(f)} />
          ))
        )}
      </div>

      {selectedFixture && (
        <AvailabilitySheet
          fixture={selectedFixture}
          playerId={playerId!}
          onClose={() => setSelectedFixture(null)}
          onSaved={() => { setSelectedFixture(null); loadData(); }}
        />
      )}
    </div>
  );
}

function FixtureRow({ fixture, onTap }: { fixture: Fixture; onTap: () => void }) {
  const d = parseISO(fixture.date);
  const isUnavailable = fixture.availabilityStatus === 'Unavailable';

  return (
    <button
      onClick={onTap}
      className={`w-full border border-border rounded-lg p-4 text-left transition-colors hover:bg-muted/50 ${
        isUnavailable ? 'bg-muted/30' : ''
      }`}
    >
      <div className="flex justify-between items-start">
        <div>
          <p className="font-medium text-sm text-foreground">{fixture.homeTeam} vs {fixture.awayTeam}</p>
          <p className="text-xs text-muted-foreground">
            {format(d, 'EEE d MMM')} · {format(d, 'HH:mm')} · {fixture.venue}
          </p>
        </div>
        <div className="text-right space-y-1">
          {fixture.selectionStatus ? (
            <span className="inline-block text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground">
              {fixture.selectionStatus}
            </span>
          ) : (
            <span className="inline-block text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
              Not selected
            </span>
          )}
          <span className={`block text-xs ${
            fixture.availabilityStatus === 'Unavailable'
              ? 'text-destructive'
              : fixture.availabilityStatus === 'Maybe'
              ? 'text-secondary-foreground'
              : 'text-muted-foreground'
          }`}>
            {fixture.availabilityStatus}
          </span>
        </div>
      </div>
      {fixture.playerNotes && (
        <p className="text-xs text-muted-foreground mt-2 italic">"{fixture.playerNotes}"</p>
      )}
    </button>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\pages\SquadSelection.tsx

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { getPlayersForMatch, GetPlayersForMatchOutput } from '@/api/getPlayersForMatch';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft } from 'lucide-react';
import MatchHeader from '@/components/MatchHeader';
import PlayerRow from '@/components/PlayerRow';
import BulkActionBar from '@/components/BulkActionBar';
import PlayerFilters from '@/components/PlayerFilters';

type Player = GetPlayersForMatchOutput['players'][0];
type MatchInfo = GetPlayersForMatchOutput['match'];

export default function SquadSelection() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(() => {
    if (!matchId) return;
    setLoading(true);
    getPlayersForMatch(matchId)
      .then(data => {
        setMatch(data.match);
        setPlayers(data.players);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [matchId]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredPlayers = players.filter(p => {
    if (filter === 'eligible') return p.eligibilityStatus !== 'blocked';
    if (filter === 'selected') return !!p.selectionStatus;
    if (filter === 'DEF' || filter === 'MID' || filter === 'FWD' || filter === 'GK') {
      const posMap: Record<string, string> = { DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward', GK: 'Goalkeeper' };
      return p.playingPosition === posMap[filter];
    }
    return true;
  });

  const toggleCheck = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-4 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-12 w-full" />
        {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="pb-20">
      <div className="container mx-auto px-4">
        <button onClick={() => navigate('/coach')} className="flex items-center gap-1 py-3 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Fixtures
        </button>
      </div>

      {match && <MatchHeader match={match} />}

      <PlayerFilters active={filter} onFilter={setFilter} />

      <div className="container mx-auto px-4">
        {filteredPlayers.map(p => (
          <PlayerRow
            key={p.id}
            player={p}
            matchId={matchId!}
            checked={checkedIds.has(p.id)}
            onToggleCheck={() => toggleCheck(p.id)}
            onRefresh={loadData}
          />
        ))}
        {filteredPlayers.length === 0 && (
          <p className="text-center text-muted-foreground py-8">No players match this filter</p>
        )}
      </div>

      {checkedIds.size > 0 && (
        <BulkActionBar
          count={checkedIds.size}
          playerIds={[...checkedIds]}
          matchId={matchId!}
          onDone={() => { setCheckedIds(new Set()); loadData(); }}
        />
      )}
    </div>
  );
}

### C:\dev\Hockey Trials App\Squad-Selection\src\repositories\availabilityRepository.ts

import {
  AirtableRepository
} from "./baseRepository";

import {
  AvailabilityException
} from "../generated/domainTypes";

import {
  TABLES
} from "../generated/tableNames";

import {
  mapAvailability
} from "../mappers/availabilityMapper";

class AvailabilityRepository
  extends AirtableRepository<AvailabilityException> {

  constructor() {
    super(
      TABLES.availabilityException,
      mapAvailability
    );
  }

  async getForMatch(
    matchId: string
  ) {
    return this.findAll({
      filterByFormula:
        `{Match}="${matchId}"`
    });
  }
}

export const availabilityRepository =
  new AvailabilityRepository();

### C:\dev\Hockey Trials App\Squad-Selection\src\repositories\baseRepository.ts

import base from '@/services/airtable';

export interface FindAllOptions {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  maxRecords?: number;
  offset?: string;
}

export class AirtableRepository<T> {
  protected table: any;

  constructor(
    private tableName: string,
    private mapper: (record: any) => T
  ) {
    this.table = base(this.tableName);
  }

  async findAll(options?: FindAllOptions): Promise<T[]> {
    const records = await this.table.select(options).all();
    return records.map(this.mapper);
  }

  async findById(id: string): Promise<T | null> {
    try {
      const record = await this.table.find(id);
      return this.mapper(record);
    } catch {
      return null;
    }
  }

  async create(fields: Record<string, any>): Promise<any> {
    const record = await this.table.create(fields);
    return record;
  }

  async update(id: string, fields: Record<string, any>): Promise<any> {
    const record = await this.table.update(id, fields);
    return record;
  }

  async delete(id: string): Promise<void> {
    await this.table.destroy(id);
  }
}

### C:\dev\Hockey Trials App\Squad-Selection\src\repositories\index.ts

// src/repositories/index.ts
export { peopleRepository } from './peopleRepository';  // note: the file is named peopleRespository.ts (typo)
export { teamsRepository } from './teamsRepository';
export { matchesRepository } from './matchesRepository';
export { selectionsRepository } from './selectionsRepository';
export { availabilityRepository } from './availabilityRepository';

### C:\dev\Hockey Trials App\Squad-Selection\src\repositories\matchesRepository.ts

import {
  AirtableRepository
} from "./baseRepository";

import {
  Match
} from "../generated/domainTypes";

import {
  TABLES
} from "../generated/tableNames";

import {
  mapMatch
} from "../mappers/matchMapper";

class MatchesRepository
  extends AirtableRepository<Match> {

  constructor() {
    super(
      TABLES.match,
      mapMatch
    );
  }

  async getUpcoming() {
    return this.findAll({
      filterByFormula:
        "IS_AFTER({Match Date},TODAY())"
    });
  }
}

export const matchesRepository =
  new MatchesRepository();

### C:\dev\Hockey Trials App\Squad-Selection\src\repositories\peopleRepository.ts

import { AirtableRepository }
  from "./baseRepository";

import { TABLES }
  from "../generated/tableNames";

import { Player }
  from "../generated/domainTypes";

import { mapPlayer }
  from "../mappers/playerMapper";

class PeopleRepository
  extends AirtableRepository<Player> {

  constructor() {
    super(
      TABLES.player,
      mapPlayer
    );
  }

  async getActivePlayers() {
    return this.findAll({
      filterByFormula:
        "{Active}=TRUE()"
    });
  }

  async getPlayersByTeam(
    teamName: string
  ) {
    return this.findAll({
      filterByFormula:
        `{Registered Team}="${teamName}"`
    });
  }

  async getByEmail(
    email: string
  ) {
    const players =
      await this.findAll({
        filterByFormula:
          `{Email}="${email}"`
      });

    return players[0] ?? null;
  }

  async findBySupabaseUserId(supabaseUserId: string): Promise<Player | null> {
    const records = await this.findAll({
      filterByFormula: `{supabaseUserId}="${supabaseUserId}"`  // use the actual field name from Airtable
    });
    return records.length > 0 ? records[0] : null;
  }
}

export const peopleRepository =
  new PeopleRepository();

### C:\dev\Hockey Trials App\Squad-Selection\src\repositories\selectionsRepository.ts

import {
  AirtableRepository
} from "./baseRepository";

import {
  SquadSelection
} from "../generated/domainTypes";

import {
  TABLES
} from "../generated/tableNames";

import {
  mapSelection
} from "../mappers/selectionMapper";

class SelectionsRepository
  extends AirtableRepository<SquadSelection> {

  constructor() {
    super(
      TABLES.squadSelection,
      mapSelection
    );
  }

  async getMatchSelections(
    matchId: string
  ) {
    return this.findAll({
      filterByFormula:
        `{Match}="${matchId}"`
    });
  }
}

export const selectionsRepository =
  new SelectionsRepository();

### C:\dev\Hockey Trials App\Squad-Selection\src\repositories\teamsRepository.ts

import {
  AirtableRepository
} from "./baseRepository";

import {
  Team
} from "../generated/domainTypes";

import {
  TABLES
} from "../generated/tableNames";

import {
  mapTeam
} from "../mappers/teamMapper";

class TeamsRepository
  extends AirtableRepository<Team> {

  constructor() {
    super(
      TABLES.team,
      mapTeam
    );
  }

  async getActiveTeams() {
    return this.findAll({
      filterByFormula:
        "{Active}=TRUE()"
    });
  }
}

export const teamsRepository =
  new TeamsRepository();

### C:\dev\Hockey Trials App\Squad-Selection\src\services\airtable.ts

// src/services/airtable.ts
import Airtable from "airtable";

const apiKey = import.meta.env.VITE_AIRTABLE_TOKEN;
const baseId = import.meta.env.VITE_AIRTABLE_BASE_ID;

if (!apiKey || !baseId) {
  throw new Error('Missing Airtable environment variables');
}

const base = new Airtable({ apiKey }).base(baseId);
export default base;

