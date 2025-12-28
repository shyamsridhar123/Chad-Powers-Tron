# GitHub Pages Deployment Setup Guide

## Problem
The GitHub Actions deployment workflow is failing with the following error:
```
Error: Failed to create deployment (status: 404)
Ensure GitHub Pages has been enabled: https://github.com/shyamsridhar123/Chad-Powers-Tron/settings/pages
```

## Solution
GitHub Pages must be enabled in the repository settings before the deployment workflow can succeed. Follow these steps:

## One-Time Setup Instructions

### Step 1: Enable GitHub Pages
1. Navigate to your repository on GitHub
2. Click on **Settings** (in the repository menu)
3. Scroll down and click on **Pages** (in the left sidebar)

### Step 2: Configure Source
1. Under **Build and deployment** section
2. Find the **Source** dropdown
3. Select **GitHub Actions** from the dropdown
4. The page will auto-save

### Step 3: Verify Configuration
1. Once configured, you should see a message: "Your site is ready to be published at https://shyamsridhar123.github.io/Chad-Powers-Tron/"
2. Return to the **Actions** tab
3. Re-run the failed workflow or push a new commit to trigger deployment

## What This Does
- Enables GitHub Pages for your repository
- Configures it to deploy from GitHub Actions (instead of a branch)
- Allows the `actions/deploy-pages@v4` action to successfully create deployments

## After Setup
Once Pages is enabled:
- Every push to the `main` branch will automatically trigger a build and deployment
- Your site will be available at: https://shyamsridhar123.github.io/Chad-Powers-Tron/
- The deployment workflow will complete successfully

## Troubleshooting
If the workflow still fails after setup:
1. Verify Pages is enabled by visiting Settings → Pages
2. Confirm "Source" is set to "GitHub Actions"
3. Check that the workflow has the correct permissions (already configured in `.github/workflows/deploy.yml`)
4. Re-run the workflow from the Actions tab

## Technical Details
The deployment workflow (`.github/workflows/deploy.yml`) uses:
- `actions/upload-pages-artifact@v3` to package the built site
- `actions/deploy-pages@v4` to deploy to GitHub Pages

The `deploy-pages` action requires the GitHub Pages API endpoint to be available, which is only accessible when Pages is enabled in repository settings.
