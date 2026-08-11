/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['class'],
    content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
  	extend: {
  		// The stock scale starts at 640px, which leaves nothing between a 360px
  		// phone and a tablet — and most of this app is used on a phone.
  		screens: {
  			xs: '420px'
  		},
  		colors: {
  			// The numbered sky scale that used to live here is gone: it was a
  			// second, contradictory source of "primary" that no token controlled.
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				foreground: 'hsl(var(--success-foreground))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				foreground: 'hsl(var(--warning-foreground))'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))',
  				'6': 'hsl(var(--chart-6))'
  			}
  		},
  		borderRadius: {
  			xl: 'calc(var(--radius) + 4px)',
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		// Warm-tinted and shallow. A neutral-grey shadow over sand surfaces
  		// reads as dirt; these are the same hue as the background.
  		boxShadow: {
  			xs:      '0 1px 2px 0 hsl(20 14% 15% / 0.04)',
  			sm:      '0 1px 3px 0 hsl(20 14% 15% / 0.06), 0 1px 2px -1px hsl(20 14% 15% / 0.04)',
  			DEFAULT: '0 2px 6px -1px hsl(20 14% 15% / 0.07), 0 1px 3px -1px hsl(20 14% 15% / 0.04)',
  			md:      '0 6px 14px -3px hsl(20 14% 15% / 0.08), 0 3px 6px -4px hsl(20 14% 15% / 0.05)',
  			lg:      '0 14px 28px -6px hsl(20 14% 15% / 0.10), 0 6px 12px -8px hsl(20 14% 15% / 0.06)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};
