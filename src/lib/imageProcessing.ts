import { ThemeParam } from './types';

/**
 * Applies theme-appropriate tinting to monochrome SVG icons.
 * Non-SVG images and colorful SVGs are returned unchanged.
 */
export async function processImageForTheme(
  blob: Blob,
  theme?: ThemeParam,
  url?: URL
): Promise<Blob> {
  // Only process if we have a theme preference
  if (!theme) {
    return blob;
  }

  // Check if this is an SVG
  if (blob.type === 'image/svg+xml') {
    try {
      const text = await blob.text();
      const processedSVG = await processSVG(text, theme, url);
      return new Blob([processedSVG], { type: 'image/svg+xml' });
    } catch (error) {
      console.error('Error processing SVG:', error);
      return blob;
    }
  }

  // For now, return non-SVG images as-is
  // We could add raster image processing with sharp later
  return blob;
}

/**
 * Detects monochrome SVGs and applies theme-appropriate colors.
 * GitHub icons are always treated as monochrome for consistent theming.
 */
export async function processSVG(
  svgContent: string,
  theme: ThemeParam,
  url?: URL
): Promise<string> {
  // This function should only be called when theme is specified
  // The check is handled in processImageForTheme

  // Parse SVG and detect if it's monochrome
  
  const fillMatches = svgContent.match(/fill\s*=\s*["']([^"']+)["']/gi) || [];
  const strokeMatches = svgContent.match(/stroke\s*=\s*["']([^"']+)["']/gi) || [];
  
  // Also check for fill/stroke in style attributes
  const styleFillMatches = svgContent.match(/fill\s*:\s*([^;}"']+)/gi) || [];
  const styleStrokeMatches = svgContent.match(/stroke\s*:\s*([^;}"']+)/gi) || [];
  
  const allColorMatches = [...fillMatches, ...strokeMatches, ...styleFillMatches, ...styleStrokeMatches];
  
  const colors = allColorMatches
    .map(match => {
      // Extract color value from different formats
      const colorMatch = match.match(/[:=]\s*["']?([^"';]+)["']?/);
      return colorMatch ? colorMatch[1].trim() : null;
    })
    .filter(Boolean) as string[];
  
  // Add special handling for GitHub
  const isGitHub = url?.hostname.includes('github');
  
  // Check if all colors are grayscale or if it's a known monochrome icon
  const isMonochrome = isGitHub || colors.every(color => {
    if (!color || color === 'none' || color === 'transparent' || color === 'currentColor') {
      return true;
    }
    
    // Check hex colors
    if (color.startsWith('#')) {
      const hex = color.substring(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return Math.abs(r - g) < 30 && Math.abs(g - b) < 30;
      } else if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return Math.abs(r - g) < 30 && Math.abs(g - b) < 30;
      }
    }
    
    // Check rgb colors
    if (color.startsWith('rgb')) {
      const matches = color.match(/\d+/g);
      if (matches && matches.length >= 3) {
        const [r, g, b] = matches.map(Number);
        return Math.abs(r - g) < 30 && Math.abs(g - b) < 30;
      }
    }
    
    // Check for gray color names
    const grayColors = ['black', 'white', 'gray', 'grey', 'silver', 'darkgray', 'darkgrey', 'lightgray', 'lightgrey'];
    return grayColors.includes(color.toLowerCase());
  });
  
  if (isMonochrome) {
    
    // Determine if the original is dark or light
    let avgLuminance = 128; // Default to middle gray
    
    const validColors = colors.filter(c => c && c !== 'none' && c !== 'transparent' && c !== 'currentColor');
    if (validColors.length > 0) {
      const luminances = validColors.map(color => {
        if (color.startsWith('#')) {
          const hex = color.substring(1);
          let r, g, b;
          if (hex.length === 3) {
            r = parseInt(hex[0] + hex[0], 16);
            g = parseInt(hex[1] + hex[1], 16);
            b = parseInt(hex[2] + hex[2], 16);
          } else {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
          }
          return 0.299 * r + 0.587 * g + 0.114 * b;
        } else if (color === 'black') {
          return 0;
        } else if (color === 'white') {
          return 255;
        }
        return 128; // Default for unknown formats
      });
      
      avgLuminance = luminances.reduce((sum, lum) => sum + lum, 0) / luminances.length;
    }
    
    const isDarkIcon = avgLuminance < 128;
    
    // Apply theme-appropriate tinting
    let tintedSVG = svgContent;
    
    // Determine the target color based on theme and icon darkness
    let targetColor: string;
    
    if (theme === 'dark') {
      // For dark theme, make dark icons light (and keep light icons light)
      targetColor = '#E0E0E0'; // Light gray for dark theme
    } else if (theme === 'light') {
      // For light theme, keep dark icons dark (and make light icons dark)
      targetColor = '#333333'; // Dark gray for light theme
    } else {
      // Should not happen as we only process with light/dark themes
      return svgContent;
    }
    
    // Replace colors in fill attributes
    tintedSVG = tintedSVG.replace(/fill\s*=\s*["']([^"']+)["']/gi, (match, color) => {
      if (color && color !== 'none' && color !== 'transparent') {
        return `fill="${targetColor}"`;
      }
      return match;
    });
    
    // Replace colors in stroke attributes
    tintedSVG = tintedSVG.replace(/stroke\s*=\s*["']([^"']+)["']/gi, (match, color) => {
      if (color && color !== 'none' && color !== 'transparent') {
        return `stroke="${targetColor}"`;
      }
      return match;
    });
    
    // Replace colors in style attributes
    tintedSVG = tintedSVG.replace(/style\s*=\s*["']([^"']+)["']/gi, (match, style) => {
      let newStyle = style;
      
      // Replace fill in style
      newStyle = newStyle.replace(/fill\s*:\s*([^;]+)/gi, (m: string, color: string) => {
        if (color && color.trim() !== 'none' && color.trim() !== 'transparent') {
          return `fill: ${targetColor}`;
        }
        return m;
      });
      
      // Replace stroke in style
      newStyle = newStyle.replace(/stroke\s*:\s*([^;]+)/gi, (m: string, color: string) => {
        if (color && color.trim() !== 'none' && color.trim() !== 'transparent') {
          return `stroke: ${targetColor}`;
        }
        return m;
      });
      
      return `style="${newStyle}"`;
    });
    
    // Replace colors in <style> tags
    tintedSVG = tintedSVG.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, css) => {
      let newCSS = css;
      
      // Replace fill in CSS
      newCSS = newCSS.replace(/fill\s*:\s*([^;}"']+)/gi, (m: string, color: string) => {
        if (color && color.trim() !== 'none' && color.trim() !== 'transparent') {
          return `fill: ${targetColor}`;
        }
        return m;
      });
      
      // Replace stroke in CSS
      newCSS = newCSS.replace(/stroke\s*:\s*([^;}"']+)/gi, (m: string, color: string) => {
        if (color && color.trim() !== 'none' && color.trim() !== 'transparent') {
          return `stroke: ${targetColor}`;
        }
        return m;
      });
      
      return `<style>${newCSS}</style>`;
    });
    
    return tintedSVG;
  }
  
  return svgContent;
}