const axios = require('axios');

/**
 * Memicu GitLab CI/CD Pipeline Trigger API
 * 
 * Endpoint: POST {gitlabHost}/api/v4/projects/{projectId}/trigger/pipeline
 * Format: application/x-www-form-urlencoded
 * 
 * @param {Object} projectConfig Konfigurasi proyek dari config/projects.js
 * @param {string} projectConfig.gitlabHost Host URL GitLab (misal https://gitlab.com)
 * @param {string|number} projectConfig.projectId Numeric ID proyek GitLab
 * @param {string} projectConfig.token Pipeline Trigger Token
 * @param {string} projectConfig.ref Target branch/ref
 * @param {Object} [projectConfig.variables] CI/CD variables opsional
 * @returns {Promise<Object>} Data pipeline hasil respons GitLab (id, web_url, status, ref)
 */
async function triggerGitlabPipeline(projectConfig) {
  const { gitlabHost = 'https://gitlab.com', projectId, token, ref = 'main', variables = {} } = projectConfig;

  if (!projectId) {
    throw new Error('Project ID GitLab tidak terkonfigurasi.');
  }

  if (!token) {
    throw new Error('Pipeline Trigger Token belum dikonfigurasi pada environment variable.');
  }

  // Normalisasi URL host untuk mencegah double slash
  const cleanHost = gitlabHost.trim().replace(/\/+$/, '');
  const endpoint = `${cleanHost}/api/v4/projects/${encodeURIComponent(projectId)}/trigger/pipeline`;

  // GitLab Pipeline Trigger API secara resmi menerima payload x-www-form-urlencoded
  const payload = new URLSearchParams();
  payload.append('token', token);
  payload.append('ref', ref);

  if (variables && typeof variables === 'object') {
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined && value !== null) {
        payload.append(`variables[${key}]`, String(value));
      }
    }
  }

  try {
    const response = await axios.post(endpoint, payload.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 15000 // 15 detik timeout
    });

    // GitLab mengembalikan HTTP 201 Created ketika pipeline berhasil dibuat
    if (response.status === 201 && response.data) {
      return {
        success: true,
        id: response.data.id,
        web_url: response.data.web_url,
        status: response.data.status,
        ref: response.data.ref,
        createdAt: response.data.created_at
      };
    }

    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    let errorMessage = error.message;

    if (error.response) {
      const { status, data } = error.response;
      let detail = '';

      if (typeof data === 'object' && data !== null) {
        if (data.message) {
          detail = typeof data.message === 'object' ? JSON.stringify(data.message) : data.message;
        } else if (data.error) {
          detail = data.error;
        } else {
          detail = JSON.stringify(data);
        }
      } else if (typeof data === 'string') {
        detail = data;
      }

      errorMessage = `GitLab API Error [HTTP ${status}]: ${detail || error.message}`;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'GitLab API Error: Permintaan timeout setelah 15 detik.';
    }

    const err = new Error(errorMessage);
    err.originalError = error;
    throw err;
  }
}

module.exports = {
  triggerGitlabPipeline
};
