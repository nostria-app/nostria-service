#!/bin/bash

# Docker Build Test Script
# This script tests the Docker build to ensure all Prisma-related issues are resolved

echo "🐳 Testing Docker build for nostria-service..."

# Build the Docker image
echo "Building Docker image..."
docker build -t nostria-service-test .

if [ $? -eq 0 ]; then
    echo "✅ Docker build successful!"
    
    # Optional: Test that the container starts
    echo "Testing container startup..."
    docker run --rm -d --name nostria-test -p 3000:3000 nostria-service-test
    
    if [ $? -eq 0 ]; then
        echo "✅ Container started successfully!"
        echo "Stopping test container..."
        docker stop nostria-test
        echo "✅ All tests passed!"
    else
        echo "❌ Container failed to start"
        exit 1
    fi
    
    # Clean up
    echo "Cleaning up test image..."
    docker rmi nostria-service-test
    
else
    echo "❌ Docker build failed!"
    exit 1
fi

echo "🎉 Docker build test complete!"