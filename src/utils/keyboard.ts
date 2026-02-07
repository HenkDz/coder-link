import { createInterface, type Interface } from 'readline';
import chalk from 'chalk';

/**
 * Keyboard shortcut handler for interactive menus
 * Adds support for: q/Q to quit, Ctrl+C graceful exit, Esc to go back
 */
export class KeyboardHandler {
  private static instance: KeyboardHandler | null = null;
  private rl: Interface | null = null;
  private quitCallback: (() => void) | null = null;
  private backCallback: (() => void) | null = null;
  private isActive = false;

  static getInstance(): KeyboardHandler {
    if (!KeyboardHandler.instance) {
      KeyboardHandler.instance = new KeyboardHandler();
    }
    return KeyboardHandler.instance;
  }

  private setupRawMode(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
    }
  }

  private restoreRawMode(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }

  /**
   * Enable keyboard shortcuts
   * @param onQuit Called when user presses 'q' or Ctrl+C
   * @param onBack Called when user presses Esc
   */
  enable(onQuit?: () => void, onBack?: () => void): void {
    if (this.isActive) return;
    
    this.quitCallback = onQuit || null;
    this.backCallback = onBack || null;
    this.isActive = true;

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.setupRawMode();

    process.stdin.on('data', this.handleInput);
    
    // Handle Ctrl+C
    process.on('SIGINT', this.handleSigint);
  }

  /**
   * Disable keyboard shortcuts
   */
  disable(): void {
    if (!this.isActive) return;
    
    this.isActive = false;
    process.stdin.removeListener('data', this.handleInput);
    process.removeListener('SIGINT', this.handleSigint);
    
    this.restoreRawMode();
    
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Show available shortcuts hint
   */
  showHints(): void {
    console.log(chalk.gray('  Press q to quit · Esc to go back · ↑/↓ Navigate · Enter Select'));
  }

  private handleInput = (key: Buffer): void => {
    const str = key.toString();
    
    // Ctrl+C
    if (str === '\u0003') {
      this.handleSigint();
      return;
    }
    
    // Esc
    if (str === '\u001B') {
      if (this.backCallback) {
        this.backCallback();
      }
      return;
    }
    
    // q or Q
    if (str === 'q' || str === 'Q') {
      if (this.quitCallback) {
        this.quitCallback();
      } else {
        console.log(chalk.gray('\n  Goodbye!\n'));
        process.exit(0);
      }
      return;
    }
  };

  private handleSigint = (): void => {
    console.log(chalk.gray('\n\n  Interrupted.\n'));
    if (this.quitCallback) {
      this.quitCallback();
    } else {
      process.exit(0);
    }
  };
}

export const keyboardHandler = KeyboardHandler.getInstance();
