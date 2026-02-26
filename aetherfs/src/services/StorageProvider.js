/**
 * AetherFS – Abstract Storage Provider
 * Base class for integrating different file storage systems (Dropbox, Yandex, Local, etc.)
 */
export class StorageProvider {
    constructor(id) {
        this.id = id || 'base'; // e.g. 'dropbox', 'yandex', 'local'
        this.nodes = [];
        this.edges = [];
        this.rootName = '';
        this.totalFiles = 0;
        this.totalFolders = 0;
        this._pathMap = new Map();
    }

    /**
     * Initializes the connection and loads the initial directory (root).
     * @param {function} onProgress - Callback(count, name) for loading status
     * @returns {Promise<{nodes: Array, edges: Array}>}
     */
    async openDirectory(onProgress) {
        throw new Error('Not implemented');
    }

    /**
     * Reads the contents of a text file (limited to maxBytes).
     * @param {Object|string} handle - Node object or path
     * @param {number} maxBytes 
     * @returns {Promise<string|null>}
     */
    async readFileText(handle, maxBytes = 8000) {
        throw new Error('Not implemented');
    }

    /**
     * Obtains a temporary URL to view the file (images, videos).
     * @param {Object|string} handle - Node object or path
     * @returns {Promise<string|null>}
     */
    async readFileURL(handle) {
        throw new Error('Not implemented');
    }

    /**
     * Downloads file as a pure Blob (for zipping/downloading).
     * @param {Object} node 
     * @returns {Promise<Blob|null>}
     */
    async getFileBlob(node) {
        throw new Error('Not implemented');
    }

    /**
     * Reads the application specific tags config JSON.
     * @returns {Promise<{pathToTag: Object}|null>}
     */
    async readTagsConfig() {
        return null; // Default: unsupported
    }

    /**
     * Writes the application specific tags config JSON.
     * @param {Object} payload - { pathToTag: { path: tag } }
     */
    async writeTagsConfig(payload) {
        // Default: unsupported
    }

    /** Create a folder */
    async createFolder(parentIdOrPath, name) {
        throw new Error('Not implemented');
    }

    /** Create a new empty file */
    async createFile(parentIdOrPath, name) {
        throw new Error('Not implemented');
    }

    /** Move a node to a different folder */
    async moveNode(sourceNode, targetFolderNode) {
        throw new Error('Not implemented');
    }

    /** Rename a node */
    async renameNode(node, newName) {
        throw new Error('Not implemented');
    }

    /** Delete a node */
    async deleteNode(node) {
        throw new Error('Not implemented');
    }

    /** Copy a node */
    async copyNode(node, targetFolderNode) {
        throw new Error('Not implemented');
    }

    /** Read a local File object and upload it */
    async uploadFile(path, file) {
        throw new Error('Not implemented');
    }
}
