# Contributing to IFRS 16 Automation

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## 🚀 Getting Started

### Prerequisites

- Python 3.11 or higher
- Git
- Anthropic API key (for testing extraction features)

### Development Setup

1. **Fork and clone the repository**

```bash
git clone https://github.com/yourusername/IFRSAI.git
cd IFRSAI
```

2. **Create virtual environment**

```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or
venv\Scripts\activate  # Windows
```

3. **Install dependencies**

```bash
pip install -r requirements.txt
pip install -r requirements-dev.txt  # Development dependencies
```

4. **Set up environment variables**

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

5. **Run tests**

```bash
pytest tests/ -v
```

## 📝 Code Style

We follow PEP 8 guidelines with some modifications:

- **Line length**: 100 characters (not 79)
- **String quotes**: Double quotes preferred
- **Docstrings**: Google style

### Formatting Tools

```bash
# Format code
black . --line-length 100

# Sort imports
isort .

# Lint
flake8 . --max-line-length=100

# Type checking
mypy .
```

## 🧪 Testing

### Writing Tests

- Place tests in `tests/` directory
- Name test files `test_*.py`
- Use descriptive test names: `test_calculate_lease_liability_with_zero_interest()`

### Running Tests

```bash
# Run all tests
pytest

# Run specific test file
pytest tests/test_calculator.py

# Run with coverage
pytest --cov=. --cov-report=html
```

## 🔀 Git Workflow

### Branch Naming

- `feature/` - New features (e.g., `feature/add-ifrs15`)
- `bugfix/` - Bug fixes (e.g., `bugfix/fix-calculation-error`)
- `docs/` - Documentation updates
- `refactor/` - Code refactoring

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add IFRS 15 revenue recognition module
fix: correct lease liability calculation for zero interest
docs: update README with API examples
refactor: extract validation logic to separate module
test: add tests for amortization schedule generation
```

### Pull Request Process

1. **Create a feature branch**

```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes**

- Write clear, commented code
- Add tests for new features
- Update documentation

3. **Commit your changes**

```bash
git add .
git commit -m "feat: your feature description"
```

4. **Push to your fork**

```bash
git push origin feature/your-feature-name
```

5. **Create Pull Request**

- Provide clear description
- Reference any related issues
- Ensure CI passes

## 📚 Documentation

### Code Documentation

- Add docstrings to all public functions and classes
- Use Google-style docstrings

Example:

```python
def calculate_lease_liability(lease: LeaseInput) -> Decimal:
    """
    Calculate present value of lease payments.
    
    Args:
        lease: LeaseInput object with lease parameters
        
    Returns:
        Present value of lease payments as Decimal
        
    Raises:
        ValueError: If lease term is negative
        
    Example:
        >>> lease = LeaseInput(...)
        >>> liability = calculate_lease_liability(lease)
        >>> print(f"Liability: {liability}")
    """
```

### README Updates

- Keep examples up-to-date
- Add new features to feature list
- Update API documentation

## 🐛 Bug Reports

### Before Submitting

1. Check if bug already reported in Issues
2. Verify you're using latest version
3. Test with minimal reproducible example

### Bug Report Template

```markdown
**Describe the bug**
Clear description of the bug

**To Reproduce**
Steps to reproduce:
1. ...
2. ...

**Expected behavior**
What you expected to happen

**Actual behavior**
What actually happened

**Environment**
- OS: [e.g., Windows 10]
- Python version: [e.g., 3.11.5]
- Package version: [e.g., 1.0.0]

**Additional context**
Any other relevant information
```

## 💡 Feature Requests

We welcome feature suggestions! Please:

1. Check if feature already requested
2. Provide clear use case
3. Explain expected behavior
4. Consider implementation complexity

## 🤝 Code Review

All submissions require review. We review for:

- **Correctness** - Does it work as intended?
- **Tests** - Are there adequate tests?
- **Documentation** - Is it well documented?
- **Style** - Does it follow code style guidelines?
- **Performance** - Are there any performance concerns?

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🙏 Questions?

- Open a Discussion on GitHub
- Email: dev@ifrsai.com
- Join our Slack community

Thank you for contributing! 🎉
