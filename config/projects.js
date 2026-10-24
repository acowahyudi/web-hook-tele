/**
 * Konfigurasi Pemetaan Proyek GitLab
 * 
 * Setiap key merepresentasikan alias proyek yang dipanggil via Telegram:
 * Contoh: "git pull project-a" -> mencocokkan key 'project-a'
 */
module.exports = {
  'project-sdkutim': {
    // URL host GitLab (dukung self-hosted maupun gitlab.com)
    gitlabHost: process.env.GITLAB_HOST || 'https://gitlab.com',
    // ID numerik proyek GitLab (bisa ditemukan di Settings > General proyek GitLab)
    projectId: process.env.PROJECT_ID_PROJECT_SDKUTIM || '12345678',
    // Pipeline Trigger Token (Settings > CI/CD > Pipeline trigger tokens)
    token: process.env.TRIGGER_TOKEN_PROJECT_SDKUTIM,
    // Target branch runner
    ref: process.env.REF_PROJECT_SDKUTIM || 'main',
    // (Opsional) Variabel kustom yang diteruskan ke CI/CD Pipeline
    variables: {
      ACTION: 'git_pull',
      TRIGGERED_BY: 'telegram_bot',
      RUNNER_TAG: process.env.RUNNER_TAG_PROJECT_SDKUTIM || 'tag-runner-deploy'
    }
  },
  'project-b': {
    gitlabHost: process.env.GITLAB_HOST || 'https://gitlab.com',
    projectId: process.env.PROJECT_ID_PROJECT_B || '87654321',
    token: process.env.TRIGGER_TOKEN_PROJECT_B,
    ref: process.env.REF_PROJECT_B || 'production',
    variables: {
      ACTION: 'git_pull',
      TRIGGERED_BY: 'telegram_bot',
      RUNNER_TAG: process.env.RUNNER_TAG_PROJECT_B || 'default-runner'
    }
  }
};
