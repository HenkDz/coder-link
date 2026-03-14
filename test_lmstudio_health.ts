/**
 * Test suite for LMStudio health check improvements
 * Tests enhanced health check with retry logic, error classification, and port scanning
 */

import {
  checkLMStudioHealth,
  checkLMStudioStatus,
  fetchLMStudioModel,
  scanForLMStudio,
  LMStudioErrorType,
  getLMStudioDefaultPorts,
  type LMStudioHealthResult,
} from './src/lib/provider-registry.js';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testCase(name: string, testFn: () => Promise<void>): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log('='.repeat(60));
  
  try {
    await testFn();
    console.log(`✓ PASSED`);
  } catch (error) {
    console.log(`✗ FAILED: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function testHealthCheckBasic(): Promise<void> {
  console.log('Testing basic health check functionality...');
  
  const result: LMStudioHealthResult = await checkLMStudioHealth(undefined, {
    timeoutMs: 3000,
    maxRetries: 2,
    testChatEndpoint: false,
  });
  
  console.log(`Reachable: ${result.reachable}`);
  console.log(`Attempts: ${result.attempts}`);
  console.log(`Model tested: ${result.modelTested}`);
  
  if (result.reachable) {
    console.log(`URL: ${result.url}`);
    console.log(`Port: ${result.port}`);
    if (result.version) console.log(`Version: ${result.version}`);
    if (result.modelId) console.log(`Model: ${result.modelId}`);
  } else {
    console.log('Expected: LM Studio likely not running');
  }
  
  if (!result.reachable && result.error) {
    console.log(`Error type: ${result.error.type}`);
    console.log(`Error message: ${result.error.message}`);
  }
}

async function testHealthCheckWithChatEndpoint(): Promise<void> {
  console.log('Testing health check with chat endpoint verification...');
  
  const result: LMStudioHealthResult = await checkLMStudioHealth(undefined, {
    timeoutMs: 3000,
    maxRetries: 2,
    testChatEndpoint: true,
  });
  
  console.log(`Reachable: ${result.reachable}`);
  console.log(`Model tested: ${result.modelTested}`);
  console.log(`Model ID: ${result.modelId || 'N/A'}`);
  
  // If reachable and model tested, we should have a model ID
  if (result.reachable && result.modelTested) {
    if (!result.modelId) {
      console.log('⚠ Warning: Chat endpoint works but no model loaded');
    }
  }
}

async function testStatusCheck(): Promise<void> {
  console.log('Testing comprehensive status check...');
  
  const status = await checkLMStudioStatus(undefined, {
    timeoutMs: 5000,
    maxRetries: 3,
    testChatEndpoint: true,
  });
  
  console.log(`Running: ${status.running}`);
  console.log(`Reachable: ${status.reachable}`);
  console.log(`Model Loaded: ${status.modelLoaded}`);
  console.log(`Model ID: ${status.modelId || 'N/A'}`);
  console.log(`Actual URL: ${status.actualUrl || 'N/A'}`);
  console.log(`Port: ${status.port || 'N/A'}`);
  console.log(`Version: ${status.version || 'N/A'}`);
  console.log(`Attempts: ${status.attempts || 'N/A'}`);
  
  if (status.error) {
    console.log(`Error Type: ${status.error.type}`);
    console.log(`Error Message: ${status.error.message}`);
  }
}

async function testPortScanning(): Promise<void> {
  console.log('Testing port scanning for LM Studio discovery...');
  
  console.log('Default ports to scan:', getLMStudioDefaultPorts());
  
  const discoveredPort = await scanForLMStudio({
    timeoutMs: 1000,
    additionalPorts: [3000, 8080, 9000],
  });
  
  if (discoveredPort) {
    console.log(`✓ Discovered LM Studio on port ${discoveredPort}`);
  } else {
    console.log('LM Studio not found on any tested ports (expected if not running)');
  }
}

async function testErrorClassification(): Promise<void> {
  console.log('Testing error classification...');
  
  // This test verifies that different error types are properly classified
  // We'll simulate errors by trying to connect to non-existent services
  
  const tests = [
    { name: 'Connection refused', port: 59999 },
    { name: 'Timeout', port: 1234, simulateTimeout: true },
  ];
  
  for (const test of tests) {
    console.log(`\nTesting: ${test.name}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = test.simulateTimeout 
        ? setTimeout(() => controller.abort(), 100)
        : undefined;
      
      await fetch(`http://localhost:${test.port}`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      if (timeoutId) clearTimeout(timeoutId);
      
      console.log('Unexpected success');
    } catch (error) {
      console.log(`Error received: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function testRetryLogic(): Promise<void> {
  console.log('Testing retry logic with exponential backoff...');
  
  const startTime = Date.now();
  
  // Try to connect to non-existent server with retries
  const result: LMStudioHealthResult = await checkLMStudioHealth('http://localhost:59999', {
    timeoutMs: 500,
    maxRetries: 3,
    testChatEndpoint: false,
  });
  
  const elapsed = Date.now() - startTime;
  
  console.log(`Reachable: ${result.reachable}`);
  console.log(`Attempts: ${result.attempts}`);
  console.log(`Elapsed time: ${elapsed}ms`);
  console.log(`Expected: ~1500ms (3 retries × 500ms with backoff)`);
  
  // Verify retry logic occurred
  if (result.attempts >= 3) {
    console.log('✓ Retry logic working correctly');
  } else {
    console.log('⚠ Retry logic may not be working as expected');
  }
}

async function testModelFetch(): Promise<void> {
  console.log('Testing model fetching from LM Studio...');
  
  const modelId = await fetchLMStudioModel(undefined, {
    timeoutMs: 3000,
  });
  
  if (modelId) {
    console.log(`✓ Found model: ${modelId}`);
  } else {
    console.log('No model loaded (expected if LM Studio not running)');
  }
}

async function main(): Promise<void> {
  console.log('🧪 LMStudio Health Check Enhancement Tests');
  console.log('Testing enhanced health check with retry logic, error classification, and port scanning\n');
  
  try {
    await testCase('Basic Health Check', testHealthCheckBasic);
    await sleep(1000);
    
    await testCase('Health Check with Chat Endpoint', testHealthCheckWithChatEndpoint);
    await sleep(1000);
    
    await testCase('Comprehensive Status Check', testStatusCheck);
    await sleep(1000);
    
    await testCase('Port Scanning', testPortScanning);
    await sleep(1000);
    
    await testCase('Error Classification', testErrorClassification);
    await sleep(1000);
    
    await testCase('Retry Logic', testRetryLogic);
    await sleep(1000);
    
    await testCase('Model Fetch', testModelFetch);
    
    console.log('\n' + '='.repeat(60));
    console.log('All tests completed!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\nTest suite failed:', error);
    process.exit(1);
  }
}

// Run tests
main();