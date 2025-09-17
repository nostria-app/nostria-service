# Docker Build Test Script (PowerShell)
# This script tests the Docker build to ensure all Prisma-related issues are resolved

Write-Host "🐳 Testing Docker build for nostria-service..." -ForegroundColor Cyan

# Build the Docker image
Write-Host "Building Docker image..." -ForegroundColor Yellow
docker build -t nostria-service-test .

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Docker build successful!" -ForegroundColor Green
    
    # Optional: Test that the container starts
    Write-Host "Testing container startup..." -ForegroundColor Yellow
    docker run --rm -d --name nostria-test -p 3000:3000 nostria-service-test
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Container started successfully!" -ForegroundColor Green
        Write-Host "Stopping test container..." -ForegroundColor Yellow
        docker stop nostria-test
        Write-Host "✅ All tests passed!" -ForegroundColor Green
    } else {
        Write-Host "❌ Container failed to start" -ForegroundColor Red
        exit 1
    }
    
    # Clean up
    Write-Host "Cleaning up test image..." -ForegroundColor Yellow
    docker rmi nostria-service-test
    
} else {
    Write-Host "❌ Docker build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "🎉 Docker build test complete!" -ForegroundColor Green