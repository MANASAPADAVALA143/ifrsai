#!/bin/bash
# IFRS 16 Automation Startup Script for Linux/Mac

echo "============================================================"
echo "IFRS 16 LEASE ACCOUNTING AUTOMATION"
echo "============================================================"
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install/upgrade dependencies
echo ""
echo "Installing dependencies..."
pip install -r requirements.txt --quiet

# Check for .env file
if [ ! -f ".env" ]; then
    echo ""
    echo "WARNING: .env file not found!"
    echo "Please create a .env file with your ANTHROPIC_API_KEY"
    echo "Example: cp .env.example .env"
    echo ""
    read -p "Press enter to continue..."
fi

# Create directories
mkdir -p uploads outputs

# Start the application
echo ""
echo "============================================================"
echo "Starting IFRS 16 API Server..."
echo "============================================================"
echo ""
echo "API Documentation: http://localhost:9000/api/docs"
echo "ReDoc: http://localhost:9000/api/redoc"
echo ""
echo "Press Ctrl+C to stop the server"
echo "============================================================"
echo ""

python app.py
