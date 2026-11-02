const {
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
	TFile,
	TFolder,
} = require( 'obsidian' );

const VIEW_TYPE = 'mandala-engine-view';
const EXPLORER_VIEW_TYPE = 'mandala-engine-explorer-view';
const MANDALA_FOLDER = 'Mandala';
const CELL_ORDER = [ 4, 5, 6, 3, 0, 7, 2, 1, 8 ];
const DEFAULT_SETTINGS = {
	cellColorMode: 'all-white',
	autoOpenRootNotes: true,
	themeMode: 'auto',
};
const DEFAULT_BACKGROUND_COLOR = '#e3e3e3';
const DEFAULT_GRAY_CELL_COLOR = '#f3f3f3';
const DEFAULT_DARK_BACKGROUND_COLOR = '#1c1e22';
const DEFAULT_DARK_GRAY_CELL_COLOR = '#24272c';

class MandalaEngineSettingTab extends PluginSettingTab {
	constructor( app, plugin ) {
		super( app, plugin );
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl( 'h2', { text: 'Mandala Engine' } );

		new Setting( containerEl )
			.setName( 'デフォルトの外観' )
			.setDesc( 'Mandala側が「デフォルトから継承」の場合に使います。自動はObsidianの外観へ追従します。' )
			.addDropdown( ( dropdown ) => {
				dropdown
					.addOption( 'auto', '自動' )
					.addOption( 'light', 'ライト' )
					.addOption( 'dark', 'ダーク' )
					.setValue( this.plugin.settings.themeMode )
					.onChange( async ( value ) => {
						await this.plugin.setThemeMode( value );
					} );
			} );

		new Setting( containerEl )
			.setName( 'デフォルトのセル配色' )
			.setDesc( 'ノート側の配色が継承の場合に使います。中央セルは常に白です。' )
			.addDropdown( ( dropdown ) => {
				dropdown
					.addOption( 'all-white', 'すべて白' )
					.addOption( 'odd-gray', '1・3・5・7を薄いグレー' )
					.addOption( 'even-gray', '2・4・6・8を薄いグレー' )
					.setValue( this.plugin.settings.cellColorMode )
					.onChange( async ( value ) => {
						await this.plugin.setCellColorMode( value );
					} );
			} );

		new Setting( containerEl )
			.setName( 'MandalaノートをMandala Engineで自動的に開く' )
			.setDesc( 'Mandalaフォルダ内のMandalaノートや既存のrootノートを開いたとき、同じタブをMandala表示へ切り替えます。' )
			.addToggle( ( toggle ) => {
				toggle
					.setValue( this.plugin.settings.autoOpenRootNotes )
					.onChange( async ( value ) => {
						await this.plugin.setAutoOpenRootNotes( value );
					} );
			} );
	}
}

class DeleteLinkedFileModal extends Modal {
	constructor( app, plugin, file, connectionType, onUnlink ) {
		super( app );
		this.plugin = plugin;
		this.file = file;
		this.connectionType = connectionType;
		this.onUnlink = onUnlink;
	}

	onOpen() {
		const { contentEl } = this;
		const deletePlan = this.connectionType === 'child'
			? this.plugin.getMandalaBranchDeletePlan( this.file )
			: [];
		const deleteCount = deletePlan.length;
		contentEl.addClass( 'mandala-engine-delete-modal' );
		contentEl.createEl( 'h2', {
			text: deleteCount > 0
				? `Mandalaファイル${ deleteCount }件を削除しますか？`
				: '接続を解除しますか？',
		} );
		contentEl.createEl( 'p', {
			text: `「${ this.file.basename }」との接続を解除します。`,
		} );
		contentEl.createEl( 'p', {
			text: deleteCount > 0
				? `このセル以下のMandalaファイル${ deleteCount }件を、Obsidianのゴミ箱へ移動できます。通常のMarkdownファイルは削除しません。`
				: '通常のMarkdownファイルは削除せず、接続だけを解除します。',
		} );

		const actions = contentEl.createDiv( 'mandala-engine-delete-modal__actions' );
		const cancel = actions.createEl( 'button', { text: 'キャンセル' } );
		cancel.addEventListener( 'click', () => this.close() );

		const keep = actions.createEl( 'button', {
			text: 'ファイルを残す',
			cls: 'mod-cta',
		} );
		keep.addEventListener( 'click', async () => {
			cancel.disabled = true;
			keep.disabled = true;
			remove.disabled = true;
			await this.onUnlink();
			this.close();
		} );

		const remove = actions.createEl( 'button', {
			text: `${ deleteCount }件をゴミ箱へ移動`,
			cls: 'mod-warning',
		} );
		remove.disabled = deleteCount === 0;
		remove.addEventListener( 'click', async () => {
			cancel.disabled = true;
			keep.disabled = true;
			remove.disabled = true;
			await this.onUnlink();
			const removed = await this.plugin.trashMandalaBranch( deletePlan );
			if ( removed ) {
				this.close();
			} else {
				this.close();
			}
		} );
	}

	onClose() {
		this.contentEl.empty();
	}
}

class UnsavedChangesModal extends Modal {
	constructor( app, onSave, onDiscard ) {
		super( app );
		this.onSave = onSave;
		this.onDiscard = onDiscard;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass( 'mandala-engine-unsaved-modal' );
		contentEl.createEl( 'h2', { text: '変更を保存しますか？' } );
		contentEl.createEl( 'p', {
			text: 'セルのタイトルまたは要約文が変更されています。',
		} );

		const actions = contentEl.createDiv( 'mandala-engine-unsaved-modal__actions' );
		const save = actions.createEl( 'button', {
			text: '保存して終了',
			cls: 'mod-cta',
		} );
		save.addEventListener( 'click', async () => {
			save.disabled = true;
			const saved = await this.onSave();
			if ( saved ) {
				this.close();
			} else {
				save.disabled = false;
			}
		} );

		const discard = actions.createEl( 'button', { text: '保存せず終了' } );
		discard.addEventListener( 'click', async () => {
			await this.onDiscard();
			this.close();
		} );

		const continueEditing = actions.createEl( 'button', { text: '編集を続ける' } );
		continueEditing.addEventListener( 'click', () => this.close() );
	}

	onClose() {
		this.contentEl.empty();
	}
}

class AboutMandalaEngineModal extends Modal {
	constructor( app, plugin ) {
		super( app );
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass( 'mandala-engine-about-modal' );

		const mark = contentEl.createDiv( 'mandala-engine-about-modal__mark' );
		mark.setAttr( 'role', 'img' );
		mark.setAttr( 'aria-label', 'Mandala Engine' );
		for ( let index = 0; index < 9; index += 1 ) {
			mark.createSpan( 'mandala-engine-about-modal__mark-cell' );
		}
		contentEl.createEl( 'h2', { text: 'About Mandala Engine' } );
		contentEl.createEl( 'p', {
			text: 'Think in 3×3. Move through ideas.',
			cls: 'mandala-engine-about-modal__tagline',
		} );
		const description = contentEl.createDiv( 'mandala-engine-about-modal__description' );
		description.createEl( 'span', {
			text: 'Mandala Engineは、ObsidianのMarkdownを土台に、',
		} );
		description.createEl( 'span', {
			text: '考えを3×3の空間で育て、つなぎ、',
		} );
		description.createEl( 'span', {
			text: '移動するための思考環境です。',
		} );
		contentEl.createEl( 'p', {
			text: 'Your notes stay yours — ordinary Markdown files in your vault.',
			cls: 'mandala-engine-about-modal__note',
		} );
		contentEl.createEl( 'small', {
			text: `Mandala Engine v${ this.plugin.manifest.version }`,
			cls: 'mandala-engine-about-modal__version',
		} );
	}

	onClose() {
		this.contentEl.empty();
	}
}

class MandalaExplorerView extends ItemView {
	constructor( leaf, plugin ) {
		super( leaf );
		this.plugin = plugin;
		this.sourcePath = '';
		this.rootPath = '';
		this.selectedPath = '';
		this.expandedPaths = new Set();
		this.renderTimer = null;
	}

	getViewType() {
		return EXPLORER_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Mandala Explorer';
	}

	getIcon() {
		return 'list-tree';
	}

	getState() {
		return {
			sourcePath: this.sourcePath,
			rootPath: this.rootPath,
			selectedPath: this.selectedPath,
		};
	}

	async setState( state ) {
		this.sourcePath = state && state.sourcePath ? state.sourcePath : '';
		this.rootPath = state && state.rootPath ? state.rootPath : '';
		this.selectedPath = state && state.selectedPath ? state.selectedPath : '';
		await this.render();
	}

	setSourceFile( file, rootFile = null ) {
		if ( ! ( file instanceof TFile ) || ! this.plugin.isMandalaStructureFile( file ) ) {
			return;
		}
		const resolvedRoot = rootFile instanceof TFile
			? rootFile
			: this.plugin.getMandalaRootFile( file );
		if (
			this.sourcePath === file.path
			&& this.selectedPath === file.path
			&& resolvedRoot instanceof TFile
			&& this.rootPath === resolvedRoot.path
		) {
			return;
		}
		this.sourcePath = file.path;
		this.selectedPath = file.path;
		if ( resolvedRoot instanceof TFile ) {
			this.rootPath = resolvedRoot.path;
			this.expandedPaths.add( resolvedRoot.path );
			for ( const path of this.plugin.getParentTrack( file ) ) {
				this.expandedPaths.add( path );
			}
		}
		this.scheduleRender();
	}

	setSelectedFile( file ) {
		if ( ! ( file instanceof TFile ) || this.selectedPath === file.path ) {
			return;
		}
		this.selectedPath = file.path;
		this.scheduleRender();
	}

	scheduleRender() {
		if ( this.renderTimer ) {
			clearTimeout( this.renderTimer );
		}
		this.renderTimer = setTimeout( () => {
			this.renderTimer = null;
			void this.render();
		}, 60 );
	}

	async onOpen() {
		this.registerEvent( this.app.metadataCache.on( 'changed', () => this.scheduleRender() ) );
		this.registerEvent( this.app.vault.on( 'rename', () => this.scheduleRender() ) );
		this.registerEvent( this.app.vault.on( 'delete', () => this.scheduleRender() ) );
		this.registerEvent( this.app.workspace.on( 'active-leaf-change', ( leaf ) => {
			const view = leaf && leaf.view;
			if ( view instanceof MandalaEngineView && view.mode === 'main' ) {
				const trackRoot = view.track.length
					? this.app.vault.getAbstractFileByPath( view.track[ 0 ] )
					: null;
				this.plugin.setExplorerContext( view.getCurrentFile(), trackRoot, leaf );
				return;
			}
		} ) );
		const initialFile = this.plugin.getExplorerContextFile();
		if ( initialFile ) {
			this.setSourceFile( initialFile );
		}
		await this.render();
	}

	async onClose() {
		if ( this.renderTimer ) {
			clearTimeout( this.renderTimer );
			this.renderTimer = null;
		}
	}

	hasChildConnections( file ) {
		if ( ! ( file instanceof TFile ) ) {
			return false;
		}
		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		for ( let position = 1; position <= 8; position += 1 ) {
			if ( this.plugin.cleanLink( frontmatter[ `mandala_${ position }` ] || '' ) ) {
				return true;
			}
		}
		return false;
	}

	getChildren( file ) {
		if ( ! ( file instanceof TFile ) ) {
			return [];
		}
		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const children = [];
		for ( let position = 1; position <= 8; position += 1 ) {
			const link = this.plugin.cleanLink( frontmatter[ `mandala_${ position }` ] || '' );
			if ( ! link ) {
				continue;
			}
			const linkedFile = this.app.metadataCache.getFirstLinkpathDest( link, file.path );
			if ( linkedFile instanceof TFile && linkedFile.extension === 'md' ) {
				children.push( {
					position,
					file: linkedFile,
					connectionType: this.plugin.getCellConnectionType(
						frontmatter,
						position,
						linkedFile
					),
				} );
			}
		}
		return children;
	}

	createNode( parent, entry, depth, activePath, visited, treePath ) {
		const { file, position = null } = entry;
		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const role = String( frontmatter.mandala_role || '' ).trim().toLowerCase();
		const isMandalaRoot = role === 'root' || this.plugin.isLegacyRootFile( file );
		const isMandala = position === null
			|| entry.connectionType !== 'reference'
			|| isMandalaRoot;
		const repeated = visited.has( file.path );
		const expandable = isMandala && ! repeated && this.hasChildConnections( file );
		const expanded = expandable && this.expandedPaths.has( file.path );
		const item = parent.createDiv( 'mandala-explorer__item' );
		const row = item.createDiv( {
			cls: `mandala-explorer__row${ file.path === activePath ? ' is-active' : '' }`,
		} );
		row.style.setProperty( '--mandala-explorer-indent', `${ depth * 16 }px` );

		const disclosure = row.createEl( 'button', {
			cls: `mandala-explorer__disclosure clickable-icon${ expandable ? '' : ' is-empty' }`,
			attr: {
				type: 'button',
				'aria-label': expanded ? '折りたたむ' : '展開する',
			},
		} );
		if ( expandable ) {
			setIcon( disclosure, expanded ? 'chevron-down' : 'chevron-right' );
			disclosure.addEventListener( 'click', ( event ) => {
				event.stopPropagation();
				if ( expanded ) {
					this.expandedPaths.delete( file.path );
				} else {
					this.expandedPaths.add( file.path );
				}
				void this.render();
			} );
		}

		if ( ! isMandala ) {
			const icon = row.createSpan( 'mandala-explorer__icon' );
			setIcon( icon, 'file-text' );
		}
		const title = row.createEl( 'span', {
			text: this.plugin.getMandalaTitle( file ),
			cls: 'mandala-explorer__title',
		} );
		if ( repeated ) {
			title.setAttr( 'aria-label', 'すでに表示済みのノート' );
			item.addClass( 'is-repeated' );
		}

		row.addEventListener( 'click', async () => {
			if ( isMandala ) {
				await this.plugin.openFileFromExplorer( file, treePath );
			} else {
				await this.plugin.openReferenceFromExplorer( file );
			}
		} );

		if ( ! expanded ) {
			return;
		}
		const nextVisited = new Set( visited );
		nextVisited.add( file.path );
		const children = item.createDiv( 'mandala-explorer__children' );
		for ( const child of this.getChildren( file ) ) {
			this.createNode(
				children,
				child,
				depth + 1,
				activePath,
				nextVisited,
				[ ...treePath, child.file.path ]
			);
		}
	}

	async render() {
		const container = this.containerEl.children[ 1 ];
		container.empty();
		container.addClass( 'mandala-explorer' );
		const header = container.createDiv( 'mandala-explorer__header' );
		header.createEl( 'strong', { text: 'Mandala Explorer' } );

		let sourceFile = this.sourcePath
			? this.app.vault.getAbstractFileByPath( this.sourcePath )
			: null;
		if ( ! ( sourceFile instanceof TFile ) ) {
			sourceFile = this.plugin.getExplorerContextFile();
		}
		if ( ! ( sourceFile instanceof TFile ) || ! this.plugin.isMandalaStructureFile( sourceFile ) ) {
			container.createEl( 'p', {
				text: 'マンダラを開くと、ここにツリーが表示されます。',
				cls: 'mandala-explorer__empty',
			} );
			return;
		}

		this.sourcePath = sourceFile.path;
		const savedRoot = this.rootPath
			? this.app.vault.getAbstractFileByPath( this.rootPath )
			: null;
		const rootFile = savedRoot instanceof TFile
			? savedRoot
			: this.plugin.getMandalaRootFile( sourceFile );
		this.expandedPaths.add( rootFile.path );
		const tree = container.createDiv( 'mandala-explorer__tree' );
		this.createNode(
			tree,
			{ file: rootFile },
			0,
			this.selectedPath || sourceFile.path,
			new Set(),
			[ rootFile.path ]
		);
	}
}

class MandalaEngineView extends ItemView {
	constructor( leaf, plugin ) {
		super( leaf );
		this.plugin = plugin;
		this.editMode = false;
		this.editingPosition = null;
		this.mode = 'sidebar';
		this.sourcePath = '';
		this.track = [];
		this.draggedCell = null;
		this.dragEnterTimer = null;
		this.dragEnterTargetKey = '';
		this.dragNavigationInProgress = false;
		this.dragLastActivity = 0;
		this.suppressCellClick = false;
		this.paletteOpen = false;
		this.hoveredPosition = null;
		this.editingInitial = null;
		this.unsavedModalOpen = false;
		this.explicitOpenPending = false;
		this.backgroundImageDropBinding = null;
		this.containerClickBinding = null;
		this.forbiddenDragTargetCache = new Map();
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		const file = this.getCurrentFile();
		return file
			? `Mandala - ${ this.plugin.getMandalaTitle( file ) }`
			: 'Mandala Engine';
	}

	getIcon() {
		return 'layout-grid';
	}

	getState() {
		return {
			mode: this.mode,
			sourcePath: this.sourcePath,
			track: this.track,
		};
	}

	async setState( state ) {
		const explicitOpen = Boolean( state && state.explicitOpen );
		this.mode = state && state.mode === 'main' ? 'main' : 'sidebar';
		this.sourcePath = state && state.sourcePath ? state.sourcePath : '';
		this.track = state && Array.isArray( state.track )
			? state.track.filter( ( path ) => typeof path === 'string' )
			: [];
		if ( this.mode === 'main' && this.sourcePath ) {
			const currentIndex = this.track.indexOf( this.sourcePath );
			if ( currentIndex >= 0 ) {
				this.track = this.track.slice( 0, currentIndex + 1 );
			} else {
				this.track.push( this.sourcePath );
			}
			if ( ! explicitOpen && ! this.plugin.hasValidMandalaTrackRoot( this.track ) ) {
				const file = this.app.vault.getAbstractFileByPath( this.sourcePath );
				if ( file instanceof TFile ) {
					await this.plugin.restoreLeafAsMarkdown( this.leaf, file );
					return;
				}
			}
		}
		this.explicitOpenPending = explicitOpen;
		try {
			await this.render();
		} finally {
			this.explicitOpenPending = false;
		}
	}

	getCurrentFile() {
		if ( this.mode === 'main' && this.sourcePath ) {
			const file = this.app.vault.getAbstractFileByPath( this.sourcePath );
			return file instanceof TFile ? file : null;
		}

		return this.app.workspace.getActiveFile();
	}

	finalizeNavigation( file ) {
		this.app.workspace.setActiveLeaf( this.leaf, { focus: true } );
		const trackRoot = this.track.length
			? this.app.vault.getAbstractFileByPath( this.track[ 0 ] )
			: null;
		this.plugin.setExplorerContext( file, trackRoot, this.leaf );
		this.app.workspace.requestSaveLayout();
	}

	async navigateTo( file ) {
		if ( this.editingPosition !== null ) {
			return;
		}
		if ( this.mode === 'main' ) {
			const existingIndex = this.track.indexOf( file.path );
			if ( existingIndex >= 0 ) {
				this.track = this.track.slice( 0, existingIndex + 1 );
			} else {
				this.track.push( file.path );
			}
			this.sourcePath = file.path;
			await this.render();
			this.finalizeNavigation( file );
			return;
		}

		await this.app.workspace.getLeaf( false ).openFile( file );
	}

	async navigateToTrack( file, track ) {
		if ( this.editingPosition !== null || this.mode !== 'main' ) {
			return;
		}
		const cleanTrack = Array.isArray( track )
			? track.filter( ( path ) => {
				const trackFile = this.app.vault.getAbstractFileByPath( path );
				return trackFile instanceof TFile && trackFile.extension === 'md';
			} )
			: [];
		this.track = cleanTrack.length ? cleanTrack : [ file.path ];
		this.sourcePath = file.path;
		await this.render();
		this.finalizeNavigation( file );
	}

	clearDragEnterTimer() {
		if ( this.dragEnterTimer ) {
			clearTimeout( this.dragEnterTimer );
			this.dragEnterTimer = null;
		}
		this.dragEnterTargetKey = '';
		for ( const target of this.containerEl.querySelectorAll( '.is-page-enter-target' ) ) {
			target.removeClass( 'is-page-enter-target' );
		}
	}

	scheduleDragNavigation( cell, linkedFile, sourceFile, position ) {
		if ( ! this.draggedCell || ! ( linkedFile instanceof TFile ) ) {
			return;
		}
		const targetKey = `${ sourceFile.path }::${ position }`;
		if ( this.dragEnterTargetKey === targetKey ) {
			return;
		}
		this.clearDragEnterTimer();
		this.dragEnterTargetKey = targetKey;
		this.dragEnterTimer = setTimeout( () => {
			if ( ! this.draggedCell || this.dragEnterTargetKey !== targetKey ) {
				return;
			}
			cell.style.setProperty( '--mandala-page-enter-duration', '900ms' );
			cell.addClass( 'is-page-enter-target' );
			this.dragEnterTimer = setTimeout( async () => {
				this.dragEnterTimer = null;
				this.dragEnterTargetKey = '';
				if ( ! this.draggedCell ) {
					return;
				}
				this.dragNavigationInProgress = true;
				this.draggedCell.crossPage = true;
				try {
					await this.navigateTo( linkedFile );
				} finally {
					setTimeout( () => {
						this.dragNavigationInProgress = false;
					}, 120 );
					setTimeout( () => {
						if (
							this.draggedCell
							&& Date.now() - this.dragLastActivity > 650
						) {
							this.clearCellDrag();
						}
					}, 750 );
				}
			}, 900 );
		}, 1800 );
	}

	registerDragBackNavigation( cell, sourceFile, previousFile ) {
		if ( ! ( previousFile instanceof TFile ) ) {
			return;
		}
		cell.addEventListener( 'dragover', ( event ) => {
			if ( ! this.draggedCell ) {
				return;
			}
			this.dragLastActivity = Date.now();
			event.preventDefault();
			cell.addClass( 'is-reorder-target' );
			this.scheduleDragNavigation( cell, previousFile, sourceFile, 0 );
			if ( event.dataTransfer ) {
				event.dataTransfer.dropEffect = 'move';
			}
		} );
		cell.addEventListener( 'dragleave', () => {
			cell.removeClass( 'is-reorder-target' );
			const targetKey = `${ sourceFile.path }::0`;
			if ( this.dragEnterTargetKey === targetKey ) {
				this.clearDragEnterTimer();
			}
		} );
		cell.addEventListener( 'drop', ( event ) => {
			if ( ! this.draggedCell ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.clearCellDrag();
		} );
	}

	registerCenterCellDrag( cell, parentFile, parentPosition, centerFile ) {
		if (
			! ( parentFile instanceof TFile )
			|| ! ( centerFile instanceof TFile )
			|| parentPosition < 1
		) {
			return;
		}
		cell.setAttr( 'draggable', 'true' );
		cell.addEventListener( 'dragstart', ( event ) => {
			this.draggedCell = {
				sourcePath: parentFile.path,
				position: parentPosition,
				linkedPath: centerFile.path,
				fromCenter: true,
			};
			this.dragLastActivity = Date.now();
			this.suppressCellClick = true;
			cell.addClass( 'is-reorder-source' );
			if ( event.dataTransfer ) {
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData(
					'application/x-mandala-cell',
					JSON.stringify( this.draggedCell )
				);
			}
		} );
		cell.addEventListener( 'dragend', () => {
			if ( this.dragNavigationInProgress ) {
				return;
			}
			this.clearCellDrag();
		} );
	}

	clearCellDrag() {
		this.clearDragEnterTimer();
		this.draggedCell = null;
		this.forbiddenDragTargetCache.clear();
		for ( const source of this.containerEl.querySelectorAll( '.is-reorder-source' ) ) {
			source.removeClass( 'is-reorder-source' );
		}
		for ( const target of this.containerEl.querySelectorAll( '.is-reorder-target' ) ) {
			target.removeClass( 'is-reorder-target' );
		}
		setTimeout( () => {
			this.suppressCellClick = false;
		}, 0 );
	}

	isForbiddenDragTarget( targetMandalaFile ) {
		if ( ! this.draggedCell || ! ( targetMandalaFile instanceof TFile ) ) {
			return false;
		}
		const cacheKey = `${ this.draggedCell.sourcePath }::${ this.draggedCell.linkedPath }::${ targetMandalaFile.path }`;
		if ( this.forbiddenDragTargetCache.has( cacheKey ) ) {
			return this.forbiddenDragTargetCache.get( cacheKey );
		}
		const originalSourceFile = this.app.vault.getAbstractFileByPath(
			this.draggedCell.sourcePath
		);
		const draggedLinkedFile = this.draggedCell.linkedPath
			? this.app.vault.getAbstractFileByPath( this.draggedCell.linkedPath )
			: null;
		const forbidden = originalSourceFile instanceof TFile
			&& targetMandalaFile.path !== originalSourceFile.path
			&& draggedLinkedFile instanceof TFile
			&& this.plugin.isFileWithinMandalaBranch(
				targetMandalaFile,
				draggedLinkedFile
			);
		this.forbiddenDragTargetCache.set( cacheKey, forbidden );
		return forbidden;
	}

	async openMarkdownFile( file ) {
		if ( ! ( file instanceof TFile ) ) {
			new Notice( 'Markdownファイルが見つかりません。' );
			return;
		}
		this.plugin.bypassNextRootAutoOpen( file );
		const leaf = this.app.workspace.getLeaf( true );
		await leaf.openFile( file );
		this.app.workspace.revealLeaf( leaf );
	}

	createReferenceTitle( cell, file, text ) {
		if ( ! ( file instanceof TFile ) ) {
			return null;
		}
		const title = cell.createEl( 'h3', { text } );
		const open = cell.createEl( 'button', {
			cls: 'mandala-engine-cell__reference-open clickable-icon',
			attr: {
				'aria-label': 'Markdownを開く',
				draggable: 'false',
				type: 'button',
			},
		} );
		setIcon( open, 'file-text' );
		open.addEventListener( 'mousedown', ( event ) => event.stopPropagation() );
		open.addEventListener( 'dragstart', ( event ) => event.preventDefault() );
		open.addEventListener( 'click', async ( event ) => {
			event.preventDefault();
			event.stopPropagation();
			await this.openMarkdownFile( file );
		} );
		return title;
	}

	getEditorValues() {
		if ( this.editingPosition === null ) {
			return null;
		}
		const cell = this.containerEl.querySelector(
			`.mandala-engine-cell[data-position="${ this.editingPosition }"]`
		);
		const title = cell && cell.querySelector( '.mandala-engine-cell__note-editor' );
		const summary = cell && cell.querySelector( '.mandala-engine-cell__summary-editor' );
		return title && summary
			? { title: title.innerText.trim(), summary: summary.innerText.trim() }
			: null;
	}

	async beginEditing( position, title, summary ) {
		if ( this.editingPosition !== null ) {
			return;
		}
		this.editMode = true;
		this.editingPosition = position;
		this.editingInitial = {
			title: String( title || '' ).trim(),
			summary: String( summary || '' ).trim(),
		};
		this.paletteOpen = false;
		await this.render();
		const editor = this.containerEl.querySelector(
			`.mandala-engine-cell[data-position="${ position }"] .mandala-engine-cell__note-editor`
		);
		if ( editor ) {
			editor.focus();
		}
	}

	async beginEditingFromCell( cell ) {
		if ( ! cell || cell.dataset.canEdit !== 'true' ) {
			return;
		}
		await this.beginEditing(
			Number( cell.dataset.position ),
			cell.dataset.editTitle || '',
			cell.dataset.editSummary || ''
		);
	}

	hasUnsavedChanges() {
		const values = this.getEditorValues();
		return Boolean(
			values
			&& this.editingInitial
			&& (
				values.title !== this.editingInitial.title
				|| values.summary !== this.editingInitial.summary
			)
		);
	}

	async saveCurrentEditing() {
		const position = this.editingPosition;
		const values = this.getEditorValues();
		const file = this.getCurrentFile();
		if ( position === null || ! values || ! ( file instanceof TFile ) ) {
			return false;
		}

		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const link = position === 0
			? ''
			: this.plugin.cleanLink( frontmatter[ `mandala_${ position }` ] || '' );
		this.editingPosition = null;
		const saved = position === 0
			? await this.plugin.saveCenterCell( file, values.title, values.summary )
			: await this.plugin.saveCell( file, position, link, values.title, values.summary );
		if ( saved ) {
			this.editMode = false;
			this.editingInitial = null;
			return true;
		}

		this.editingPosition = position;
		await this.render();
		return false;
	}

	async discardCurrentEditing() {
		this.editMode = false;
		this.editingPosition = null;
		this.editingInitial = null;
		await this.render();
	}

	async requestExitEditing() {
		if ( this.editingPosition === null ) {
			return;
		}
		if ( ! this.hasUnsavedChanges() ) {
			await this.discardCurrentEditing();
			return;
		}
		if ( this.unsavedModalOpen ) {
			return;
		}
		this.unsavedModalOpen = true;
		const modal = new UnsavedChangesModal(
			this.app,
			async () => {
				const saved = await this.saveCurrentEditing();
				if ( saved ) {
					this.unsavedModalOpen = false;
				}
				return saved;
			},
			async () => {
				this.unsavedModalOpen = false;
				await this.discardCurrentEditing();
			}
		);
		const originalClose = modal.onClose.bind( modal );
		modal.onClose = () => {
			this.unsavedModalOpen = false;
			originalClose();
		};
		modal.open();
	}

	getDroppedMarkdownFile( event, sourcePath ) {
		const draggable = this.app.dragManager && this.app.dragManager.draggable;
		if ( draggable && draggable.file instanceof TFile ) {
			return draggable.file.extension === 'md' ? draggable.file : null;
		}

		const transfer = event.dataTransfer;
		if ( ! transfer ) {
			return null;
		}

		const candidates = [];
		for ( const type of [ 'text/plain', 'text/uri-list', 'application/json' ] ) {
			const value = transfer.getData( type );
			if ( value ) {
				candidates.push( value );
			}
		}

		for ( const candidate of candidates ) {
			let value = candidate.trim();
			if ( value.startsWith( '{' ) ) {
				try {
					const parsed = JSON.parse( value );
					value = parsed.path || parsed.file || parsed.link || '';
				} catch ( error ) {
					continue;
				}
			}

			value = this.plugin.cleanLink( value ).replace( /\.md$/i, '' );
			const file = this.app.metadataCache.getFirstLinkpathDest( value, sourcePath );
			if ( file instanceof TFile && file.extension === 'md' ) {
				return file;
			}
		}

		return null;
	}

	getDroppedImageFile( event, sourcePath ) {
		const isImage = ( file ) => (
			file instanceof TFile
			&& [ 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg' ]
				.includes( file.extension.toLowerCase() )
		);
		const draggable = this.app.dragManager && this.app.dragManager.draggable;
		if ( draggable && isImage( draggable.file ) ) {
			return draggable.file;
		}

		const transfer = event.dataTransfer;
		if ( ! transfer ) {
			return null;
		}
		const candidates = [];
		for ( const type of [ 'text/plain', 'text/uri-list', 'application/json' ] ) {
			const value = transfer.getData( type );
			if ( value ) {
				candidates.push( value );
			}
		}
		for ( const candidate of candidates ) {
			let value = candidate.trim();
			if ( value.startsWith( '{' ) ) {
				try {
					const parsed = JSON.parse( value );
					value = parsed.path || parsed.file || parsed.link || '';
				} catch ( error ) {
					continue;
				}
			}
			value = this.plugin.cleanLink( value );
			const exactFile = this.app.vault.getAbstractFileByPath( value );
			if ( isImage( exactFile ) ) {
				return exactFile;
			}
			const resolvedFile = this.app.metadataCache.getFirstLinkpathDest( value, sourcePath );
			if ( isImage( resolvedFile ) ) {
				return resolvedFile;
			}
		}
		return null;
	}

	registerBackgroundImageDrop( container, sourceFile ) {
		this.clearBackgroundImageDrop();
		const isBackgroundTarget = ( target ) => (
			target
			&& typeof target.closest === 'function'
			&& ! target.closest( '.mandala-engine-cell' )
			&& ! target.closest( '.mandala-engine-header' )
			&& ! target.closest( '.mandala-engine-track' )
		);
		const onDragOver = ( event ) => {
			if ( this.draggedCell || ! isBackgroundTarget( event.target ) ) {
				return;
			}
			event.preventDefault();
			container.addClass( 'is-background-image-drag-over' );
			if ( event.dataTransfer ) {
				event.dataTransfer.dropEffect = 'copy';
			}
		};
		const onDragLeave = ( event ) => {
			if ( event.relatedTarget && container.contains( event.relatedTarget ) ) {
				return;
			}
			container.removeClass( 'is-background-image-drag-over' );
		};
		const onDrop = async ( event ) => {
			container.removeClass( 'is-background-image-drag-over' );
			if ( this.draggedCell || ! isBackgroundTarget( event.target ) ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const imageFile = this.getDroppedImageFile( event, sourceFile.path );
			if ( ! imageFile ) {
				new Notice( 'Vault内の画像ファイルを背景へドロップしてください。' );
				return;
			}
			await this.plugin.setMandalaBackgroundImage( sourceFile, imageFile );
		};
		container.addEventListener( 'dragover', onDragOver );
		container.addEventListener( 'dragleave', onDragLeave );
		container.addEventListener( 'drop', onDrop );
		this.backgroundImageDropBinding = {
			container,
			onDragOver,
			onDragLeave,
			onDrop,
		};
	}

	clearBackgroundImageDrop() {
		const binding = this.backgroundImageDropBinding;
		if ( ! binding ) {
			return;
		}
		binding.container.removeEventListener( 'dragover', binding.onDragOver );
		binding.container.removeEventListener( 'dragleave', binding.onDragLeave );
		binding.container.removeEventListener( 'drop', binding.onDrop );
		binding.container.removeClass( 'is-background-image-drag-over' );
		this.backgroundImageDropBinding = null;
	}

	clearContainerClickBinding() {
		const binding = this.containerClickBinding;
		if ( ! binding ) {
			return;
		}
		binding.container.removeEventListener( 'click', binding.onClick );
		this.containerClickBinding = null;
	}

	registerEmptyCellDrop( cell, sourceFile, position ) {
		cell.addEventListener( 'dragover', ( event ) => {
			if ( this.draggedCell ) {
				return;
			}
			this.dragLastActivity = Date.now();
			event.preventDefault();
			cell.addClass( 'is-drag-over' );
			if ( event.dataTransfer ) {
				event.dataTransfer.dropEffect = 'link';
			}
		} );
		cell.addEventListener( 'dragleave', () => cell.removeClass( 'is-drag-over' ) );
		cell.addEventListener( 'drop', async ( event ) => {
			if ( this.draggedCell ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			cell.removeClass( 'is-drag-over' );
			const droppedFile = this.getDroppedMarkdownFile( event, sourceFile.path );
			if ( ! droppedFile ) {
				new Notice( 'Markdownファイルをドロップしてください。' );
				return;
			}

			const droppedCache = this.app.metadataCache.getFileCache( droppedFile );
			const droppedFrontmatter = droppedCache && droppedCache.frontmatter
				? droppedCache.frontmatter
				: {};
			await this.plugin.saveCell(
				sourceFile,
				position,
				droppedFile.path.replace( /\.md$/i, '' ),
				this.plugin.getMandalaTitle( droppedFile ),
				droppedFrontmatter.mandala_summary || '',
				'reference'
			);
		} );
	}

	registerCellReorder( cell, sourceFile, position, linkedFile ) {
		cell.addEventListener( 'dragover', ( event ) => {
			if (
				! this.draggedCell
				|| (
					this.draggedCell.sourcePath === sourceFile.path
					&& this.draggedCell.position === position
				)
			) {
				return;
			}
			if ( this.isForbiddenDragTarget( sourceFile ) ) {
				cell.removeClass( 'is-reorder-target' );
				const targetKey = `${ sourceFile.path }::${ position }`;
				if ( this.dragEnterTargetKey === targetKey ) {
					this.clearDragEnterTimer();
				}
				if ( event.dataTransfer ) {
					event.dataTransfer.dropEffect = 'none';
				}
				return;
			}
			this.dragLastActivity = Date.now();
			event.preventDefault();
			cell.addClass( 'is-reorder-target' );
			if ( linkedFile instanceof TFile ) {
				this.scheduleDragNavigation( cell, linkedFile, sourceFile, position );
			} else {
				this.clearDragEnterTimer();
			}
			if ( event.dataTransfer ) {
				event.dataTransfer.dropEffect = 'move';
			}
		} );
		cell.addEventListener( 'dragleave', () => {
			cell.removeClass( 'is-reorder-target' );
			const targetKey = `${ sourceFile.path }::${ position }`;
			if ( this.dragEnterTargetKey === targetKey ) {
				this.clearDragEnterTimer();
			}
		} );
		cell.addEventListener( 'drop', async ( event ) => {
			if (
				! this.draggedCell
				|| (
					this.draggedCell.sourcePath === sourceFile.path
					&& this.draggedCell.position === position
				)
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const dragPayload = { ...this.draggedCell };
			this.clearDragEnterTimer();
			this.suppressCellClick = true;
			try {
				const originalSourceFile = this.app.vault.getAbstractFileByPath(
					dragPayload.sourcePath
				);
				if ( ! ( originalSourceFile instanceof TFile ) ) {
					new Notice( '移動元のMandalaが見つかりません。' );
					return;
				}
				const draggedLinkedFile = dragPayload.linkedPath
					? this.app.vault.getAbstractFileByPath( dragPayload.linkedPath )
					: null;
				if (
					sourceFile.path !== originalSourceFile.path
					&& draggedLinkedFile instanceof TFile
					&& this.plugin.isFileWithinMandalaBranch( sourceFile, draggedLinkedFile )
				) {
					new Notice( '自分自身または自分の下位階層には移動できません。' );
					return;
				}
				if ( originalSourceFile.path === sourceFile.path ) {
					await this.plugin.swapCells(
						sourceFile,
						dragPayload.position,
						position,
						Boolean( linkedFile )
					);
				} else {
					await this.plugin.transferCellAcrossMandalas(
						originalSourceFile,
						dragPayload.position,
						sourceFile,
						position
					);
				}
			} finally {
				this.clearCellDrag();
			}
		} );

		if ( ! linkedFile ) {
			return;
		}

		cell.setAttr( 'draggable', 'true' );
		cell.addEventListener( 'dragstart', ( event ) => {
			this.draggedCell = {
				sourcePath: sourceFile.path,
				position,
				linkedPath: linkedFile.path,
			};
			this.dragLastActivity = Date.now();
			this.suppressCellClick = true;
			cell.addClass( 'is-reorder-source' );
			if ( event.dataTransfer ) {
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData(
					'application/x-mandala-cell',
					JSON.stringify( this.draggedCell )
				);
			}
		} );
		cell.addEventListener( 'dragend', () => {
			if ( this.dragNavigationInProgress ) {
				return;
			}
			this.clearCellDrag();
		} );
	}

	async onOpen() {
		this.registerDomEvent( this.containerEl.ownerDocument, 'keydown', async ( event ) => {
			if ( event.isComposing || event.keyCode === 229 ) {
				return;
			}
			if ( event.key === 'Escape' && this.draggedCell ) {
				event.preventDefault();
				this.clearCellDrag();
				return;
			}
			if ( this.editingPosition !== null ) {
				if ( event.key === 'Escape' ) {
					event.preventDefault();
					await this.requestExitEditing();
				} else if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
					event.preventDefault();
					await this.saveCurrentEditing();
				}
				return;
			}
			const target = event.target;
			if (
				target
				&& (
					target.isContentEditable
					|| [ 'INPUT', 'TEXTAREA', 'SELECT' ].includes( target.tagName )
				)
			) {
				return;
			}
			if ( event.key.toLowerCase() === 'z' && ( event.metaKey || event.ctrlKey ) ) {
				event.preventDefault();
				await this.plugin.undoLastCellOperation();
				return;
			}
			if ( event.key.toLowerCase() !== 'e' || this.hoveredPosition === null ) {
				return;
			}
			const cell = this.containerEl.querySelector(
				`.mandala-engine-cell[data-position="${ this.hoveredPosition }"]`
			);
			if ( cell && cell.dataset.canEdit === 'true' ) {
				event.preventDefault();
				await this.beginEditingFromCell( cell );
			}
		} );
		this.registerDomEvent( this.containerEl.ownerDocument, 'dragend', () => {
			if ( ! this.dragNavigationInProgress && this.draggedCell ) {
				this.clearCellDrag();
			}
		} );
		this.registerEvent(
			this.app.workspace.on( 'file-open', () => {
				if ( this.mode === 'sidebar' ) {
					this.render();
				}
			} )
		);
		this.registerEvent(
			this.app.metadataCache.on( 'changed', ( changedFile ) => {
				if ( changedFile === this.getCurrentFile() ) {
					this.render();
				}
			} )
		);
		await this.render();
	}

	async onClose() {
		this.clearCellDrag();
		this.clearBackgroundImageDrop();
		this.clearContainerClickBinding();
	}

	async render() {
		const container = this.containerEl.children[ 1 ];
		this.clearBackgroundImageDrop();
		this.clearContainerClickBinding();
		container.empty();
		container.removeClass( 'mandala-engine-view--main' );
		container.removeClass( 'mandala-engine-view--sidebar' );
		container.removeClass( 'mandala-engine-view--odd-gray' );
		container.removeClass( 'mandala-engine-view--even-gray' );
		container.removeClass( 'mandala-engine-view--theme-auto' );
		container.removeClass( 'mandala-engine-view--theme-light' );
		container.removeClass( 'mandala-engine-view--theme-dark' );
		container.addClass( 'mandala-engine-view' );
		container.addClass( `mandala-engine-view--${ this.mode }` );
		const file = this.getCurrentFile();
		if (
			this.mode === 'main'
			&& file instanceof TFile
			&& this.app.workspace.activeLeaf === this.leaf
		) {
			const trackRoot = this.track.length
				? this.app.vault.getAbstractFileByPath( this.track[ 0 ] )
				: null;
			this.plugin.setExplorerContext( file, trackRoot, this.leaf );
		}
		if (
			this.mode === 'main'
			&& file instanceof TFile
			&& ! this.explicitOpenPending
			&& ! this.plugin.hasValidMandalaTrackRoot( this.track )
		) {
			await this.plugin.restoreLeafAsMarkdown( this.leaf, file );
			return;
		}
		if ( this.leaf && typeof this.leaf.updateHeader === 'function' ) {
			this.leaf.updateHeader();
		}
		const effectiveColorMode = file
			? this.plugin.getEffectiveCellColorMode( file )
			: this.plugin.settings.cellColorMode;
		const mandalaThemeMode = file
			? this.plugin.getMandalaThemeMode( file )
			: 'inherit';
		const effectiveThemeMode = file
			? this.plugin.getEffectiveMandalaThemeMode( file )
			: this.plugin.settings.themeMode;
		const resolvedTheme = this.plugin.resolveMandalaTheme( effectiveThemeMode );
		container.addClass( `mandala-engine-view--theme-${ effectiveThemeMode }` );
		const mandalaColors = file
			? this.plugin.getMandalaColors( file, resolvedTheme )
			: {
				background: resolvedTheme === 'dark'
					? DEFAULT_DARK_BACKGROUND_COLOR
					: DEFAULT_BACKGROUND_COLOR,
				grayCell: resolvedTheme === 'dark'
					? DEFAULT_DARK_GRAY_CELL_COLOR
					: DEFAULT_GRAY_CELL_COLOR,
				hasCustomBackground: false,
				hasCustomGrayCell: false,
			};
		if ( mandalaColors.hasCustomBackground ) {
			container.style.setProperty( '--mandala-background-color', mandalaColors.background );
		} else {
			container.style.removeProperty( '--mandala-background-color' );
		}
		if ( mandalaColors.hasCustomGrayCell ) {
			container.style.setProperty( '--mandala-gray-cell-color', mandalaColors.grayCell );
		} else {
			container.style.removeProperty( '--mandala-gray-cell-color' );
		}
		const backgroundImage = file
			? this.plugin.getMandalaBackgroundImage( file )
			: { file: null, opacity: 0.3 };
		if ( backgroundImage.file instanceof TFile ) {
			const resourcePath = this.app.vault.adapter.getResourcePath(
				backgroundImage.file.path
			);
			container.addClass( 'has-background-image' );
			container.style.setProperty(
				'--mandala-background-image',
				`url("${ resourcePath.replace( /"/g, '%22' ) }")`
			);
			container.style.setProperty(
				'--mandala-background-image-opacity',
				String( backgroundImage.opacity )
			);
		} else {
			container.removeClass( 'has-background-image' );
			container.style.removeProperty( '--mandala-background-image' );
			container.style.removeProperty( '--mandala-background-image-opacity' );
		}
		if ( effectiveColorMode === 'odd-gray' ) {
			container.addClass( 'mandala-engine-view--odd-gray' );
		} else if ( effectiveColorMode === 'even-gray' ) {
			container.addClass( 'mandala-engine-view--even-gray' );
		}

		const header = container.createDiv( 'mandala-engine-header' );
		header.createEl( 'strong', {
			text: file ? this.plugin.getMandalaTitle( file ) : 'Mandala Engine',
		} );
		const palette = header.createDiv( {
			cls: `mandala-engine-palette${ this.paletteOpen ? ' is-open' : '' }`,
		} );
		const paletteToggle = palette.createEl( 'button', {
			cls: 'mandala-engine-palette__toggle clickable-icon',
			attr: {
				'aria-label': 'Mandala options',
				'aria-expanded': this.paletteOpen ? 'true' : 'false',
			},
		} );
		setIcon( paletteToggle, 'sliders-horizontal' );
		paletteToggle.addEventListener( 'click', () => {
			this.paletteOpen = ! this.paletteOpen;
			paletteToggle.setAttr( 'aria-expanded', this.paletteOpen ? 'true' : 'false' );
			if ( this.paletteOpen ) {
				palette.addClass( 'is-open' );
			} else {
				palette.removeClass( 'is-open' );
			}
		} );

		const palettePanel = palette.createDiv( 'mandala-engine-palette__panel' );
		const onContainerClick = async ( event ) => {
			if ( ! this.editMode && ! this.paletteOpen ) {
				return;
			}

			const target = event.target;
			if ( ! target || typeof target.closest !== 'function' ) {
				return;
			}
			if ( target.closest( '.mandala-engine-header' ) ) {
				return;
			}
			if (
				target.closest( '.mandala-engine-cell' )
				|| target.closest( '.mandala-engine-track' )
			) {
				this.paletteOpen = false;
				palette.removeClass( 'is-open' );
				paletteToggle.setAttr( 'aria-expanded', 'false' );
				return;
			}

			this.paletteOpen = false;
			if ( this.editingPosition !== null ) {
				await this.requestExitEditing();
			} else {
				await this.render();
			}
		};
		container.addEventListener( 'click', onContainerClick );
		this.containerClickBinding = {
			container,
			onClick: onContainerClick,
		};

		if ( ! file || file.extension !== 'md' ) {
			container.createEl( 'p', {
				text: 'Open a Markdown note to begin.',
			} );
			return;
		}
		if ( this.mode === 'main' ) {
			this.registerBackgroundImageDrop( container, file );
		}

		const themeControl = palettePanel.createDiv( 'mandala-engine-palette__color' );
		themeControl.createEl( 'label', { text: '外観' } );
		const themeSelect = themeControl.createEl( 'select' );
		for ( const [ value, label ] of [
			[ 'inherit', 'デフォルトから継承' ],
			[ 'auto', '自動' ],
			[ 'light', 'ライト' ],
			[ 'dark', 'ダーク' ],
		] ) {
			themeSelect.createEl( 'option', { text: label, value } );
		}
		themeSelect.value = mandalaThemeMode;
		themeSelect.addEventListener( 'change', async () => {
			await this.plugin.setMandalaRootTheme( file, themeSelect.value );
		} );
		themeControl.createEl( 'small', {
			text: `表示: ${ this.plugin.getThemeModeLabel( effectiveThemeMode, resolvedTheme ) }`,
		} );

		const colorControl = palettePanel.createDiv( 'mandala-engine-palette__color' );
		colorControl.createEl( 'label', {
			text: 'セルの配色',
		} );
		const colorSelect = colorControl.createEl( 'select' );
		for ( const [ value, label ] of [
			[ 'inherit', '親から継承' ],
			[ 'all-white', 'すべて白' ],
			[ 'odd-gray', '1・3・5・7' ],
			[ 'even-gray', '2・4・6・8' ],
		] ) {
			colorSelect.createEl( 'option', { text: label, value } );
		}
		colorSelect.value = this.plugin.getMandalaColorMode( file );
		colorSelect.addEventListener( 'change', async () => {
			await this.plugin.setMandalaColorMode( file, colorSelect.value );
		} );
		colorControl.createEl( 'small', {
			text: `表示: ${ this.plugin.getColorModeLabel( effectiveColorMode ) }`,
		} );

		const rootFile = this.plugin.getMandalaRootFile( file );
		const customColors = palettePanel.createDiv( 'mandala-engine-palette__custom-colors' );
		customColors.createEl( 'label', {
			text: 'ルートから継承する色',
			cls: 'mandala-engine-palette__section-label',
		} );
		const backgroundRow = customColors.createDiv( 'mandala-engine-palette__color-row' );
		backgroundRow.createEl( 'span', { text: '背景' } );
		const backgroundPicker = backgroundRow.createEl( 'input', {
			attr: {
				type: 'color',
				'aria-label': 'マンダラの背景色',
			},
		} );
		backgroundPicker.value = mandalaColors.background;
		backgroundPicker.addEventListener( 'change', async () => {
			await this.plugin.setMandalaRootColor(
				file,
				'mandala_background_color',
				backgroundPicker.value
			);
		} );

		const grayCellRow = customColors.createDiv( 'mandala-engine-palette__color-row' );
		grayCellRow.createEl( 'span', { text: 'グレーセル' } );
		const grayCellPicker = grayCellRow.createEl( 'input', {
			attr: {
				type: 'color',
				'aria-label': 'グレーセルの背景色',
			},
		} );
		grayCellPicker.value = mandalaColors.grayCell;
		grayCellPicker.addEventListener( 'change', async () => {
			await this.plugin.setMandalaRootColor(
				file,
				'mandala_gray_cell_color',
				grayCellPicker.value
			);
		} );

		const resetColors = customColors.createEl( 'button', {
			text: '標準色に戻す',
			cls: 'mandala-engine-palette__reset-colors',
		} );
		resetColors.addEventListener( 'click', async () => {
			await this.plugin.resetMandalaRootColors( file );
		} );
		customColors.createEl( 'small', {
			text: `保存先: ${ this.plugin.getMandalaTitle( rootFile ) }`,
		} );

		const backgroundImageControl = palettePanel.createDiv(
			'mandala-engine-palette__background-image'
		);
		backgroundImageControl.createEl( 'label', {
			text: '背景画像',
			cls: 'mandala-engine-palette__section-label',
		} );
		const backgroundImageName = backgroundImageControl.createEl( 'small', {
			text: backgroundImage.file
				? backgroundImage.file.path
				: '背景へ画像をドロップ',
		} );
		const opacityRow = backgroundImageControl.createDiv(
			'mandala-engine-palette__opacity-row'
		);
		opacityRow.createEl( 'span', { text: '濃さ' } );
		const opacityValue = opacityRow.createEl( 'small', {
			text: `${ Math.round( backgroundImage.opacity * 100 ) }%`,
		} );
		const opacitySlider = backgroundImageControl.createEl( 'input', {
			attr: {
				type: 'range',
				min: '10',
				max: '100',
				step: '1',
				value: String( Math.round( backgroundImage.opacity * 100 ) ),
				'aria-label': '背景画像の濃さ',
			},
		} );
		opacitySlider.disabled = ! backgroundImage.file;
		opacitySlider.addEventListener( 'input', () => {
			const opacity = Number( opacitySlider.value ) / 100;
			opacityValue.setText( `${ opacitySlider.value }%` );
			container.style.setProperty(
				'--mandala-background-image-opacity',
				String( opacity )
			);
		} );
		opacitySlider.addEventListener( 'change', async () => {
			await this.plugin.setMandalaBackgroundImageOpacity(
				file,
				Number( opacitySlider.value ) / 100
			);
		} );
		const removeBackgroundImage = backgroundImageControl.createEl( 'button', {
			text: '背景画像を解除',
			cls: 'mandala-engine-palette__remove-background-image',
		} );
		removeBackgroundImage.disabled = ! backgroundImage.file;
		removeBackgroundImage.addEventListener( 'click', async () => {
			await this.plugin.clearMandalaBackgroundImage( file );
		} );

		const aboutButton = palettePanel.createEl( 'button', {
			text: `Mandala Engine v${ this.plugin.manifest.version }`,
			cls: 'mandala-engine-palette__about',
			attr: {
				type: 'button',
				'aria-label': 'About Mandala Engine',
			},
		} );
		aboutButton.addEventListener( 'click', ( event ) => {
			event.preventDefault();
			event.stopPropagation();
			new AboutMandalaEngineModal( this.app, this.plugin ).open();
		} );

		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const workspace = this.mode === 'main'
			? container.createDiv( 'mandala-engine-workspace' )
			: container;

		if ( this.mode === 'main' ) {
			const validTrack = this.track.filter( ( path ) => {
				const trackFile = this.app.vault.getAbstractFileByPath( path );
				return trackFile instanceof TFile && trackFile.extension === 'md';
			} );
			this.track = validTrack.length ? validTrack : [ file.path ];

			const trackNav = workspace.createEl( 'nav', {
				cls: 'mandala-engine-track',
			} );
			const trackList = trackNav.createEl( 'ol', {
				cls: 'mandala-engine-track__list',
			} );
			const completeTrack = this.track.map( ( path, index ) => ( { path, index } ) );
			const visibleTrack = completeTrack.length > 4
				? [
					completeTrack[ 0 ],
					{ isEllipsis: true },
					...completeTrack.slice( -2 ),
				]
				: completeTrack;
			for ( const entry of visibleTrack ) {
				if ( entry.isEllipsis ) {
					const ellipsisItem = trackList.createEl( 'li', {
						cls: 'mandala-engine-track__item mandala-engine-track__ellipsis',
					} );
					ellipsisItem.createEl( 'span', { text: '…' } );
					continue;
				}

				const { path, index } = entry;
				const trackFile = this.app.vault.getAbstractFileByPath( path );
				if ( ! ( trackFile instanceof TFile ) ) {
					continue;
				}
				const item = trackList.createEl( 'li', {
					cls: 'mandala-engine-track__item',
				} );
				if ( index === this.track.length - 1 ) {
					item.createEl( 'span', {
						text: this.plugin.getMandalaTitle( trackFile ),
						attr: { 'aria-current': 'page' },
					} );
				} else {
					const trackButton = item.createEl( 'button', {
						text: this.plugin.getMandalaTitle( trackFile ),
						cls: 'mandala-engine-track__button',
					} );
					trackButton.addEventListener( 'click', () => this.navigateTo( trackFile ) );
				}
			}
		}

		const grid = workspace.createDiv( 'mandala-engine-grid' );

		for ( const position of CELL_ORDER ) {
			const cell = grid.createDiv( {
				cls: `mandala-engine-cell${ position === 0 ? ' mandala-engine-cell--center' : '' }`,
			} );
			cell.dataset.position = String( position );
			if (
				this.draggedCell
				&& (
					(
						this.draggedCell.sourcePath === file.path
						&& this.draggedCell.position === position
					)
					|| (
						position === 0
						&& this.draggedCell.fromCenter
						&& this.draggedCell.linkedPath === file.path
					)
				)
			) {
				cell.addClass( 'is-reorder-source' );
			}
			cell.addEventListener( 'mouseenter', () => {
				this.hoveredPosition = position;
			} );
			cell.addEventListener( 'mouseleave', () => {
				if ( this.hoveredPosition === position ) {
					this.hoveredPosition = null;
				}
			} );

			if ( position === 0 ) {
				const summary = frontmatter.mandala_summary || '';
				const isRootCell = this.mode === 'main' && this.track.length === 1;

				if ( this.editingPosition === 0 ) {
					cell.addClass( 'is-editing' );
					const titleEditor = cell.createEl( 'h3', {
						text: this.plugin.getMandalaTitle( file ),
						cls: 'mandala-engine-cell__note-editor',
						attr: {
							contenteditable: 'true',
							'data-placeholder': 'タイトル',
							spellcheck: 'false',
						},
					} );
					titleEditor.addEventListener( 'keydown', ( event ) => {
						if ( event.key === 'Enter' ) {
							if ( event.isComposing || event.keyCode === 229 ) {
								return;
							}
							event.preventDefault();
							summaryEditor.focus();
						}
					} );

					const summaryEditor = cell.createEl( 'p', {
						text: String( summary ),
						cls: 'mandala-engine-cell__summary-editor',
						attr: {
							contenteditable: 'true',
							'data-placeholder': '要約文',
						},
					} );

					const actions = cell.createDiv( 'mandala-engine-cell__actions' );
					const save = actions.createEl( 'button', {
						text: '保存',
						cls: 'mod-cta',
					} );
					save.addEventListener( 'click', () => this.saveCurrentEditing() );

					const cancel = actions.createEl( 'button', { text: '取消' } );
					cancel.addEventListener( 'click', () => this.requestExitEditing() );
					continue;
				}

				cell.createEl( 'h3', { text: this.plugin.getMandalaTitle( file ) } );
				if ( summary ) {
					cell.createEl( 'p', { text: String( summary ) } );
				}

				const previousPath = this.mode === 'main' && this.track.length > 1
					? this.track[ this.track.length - 2 ]
					: '';
				const previousFile = previousPath
					? this.app.vault.getAbstractFileByPath( previousPath )
					: null;
				const parent = this.plugin.getMandalaParentLink( frontmatter, file );
				if ( isRootCell ) {
					cell.addClass( 'is-editable' );
					cell.dataset.canEdit = 'true';
					cell.dataset.editTitle = this.plugin.getMandalaTitle( file );
					cell.dataset.editSummary = String( summary );
					cell.setAttr( 'tabindex', '0' );
					cell.addEventListener( 'click', ( event ) => {
						if ( event.altKey ) {
							this.openMarkdownFile( file );
							return;
						}
						if ( event.shiftKey ) {
							this.beginEditingFromCell( cell );
						}
					} );
				} else if ( previousFile instanceof TFile ) {
					cell.addClass( 'is-linked' );
					cell.addClass( 'is-editable' );
					cell.dataset.canEdit = 'true';
					cell.dataset.editTitle = this.plugin.getMandalaTitle( file );
					cell.dataset.editSummary = String( summary );
					cell.setAttr( 'tabindex', '0' );
					const parentPosition = this.plugin.findCellPositionLinkingTo(
						previousFile,
						file
					);
					this.registerCenterCellDrag(
						cell,
						previousFile,
						parentPosition,
						file
					);
					this.registerDragBackNavigation( cell, file, previousFile );
					cell.addEventListener( 'click', ( event ) => {
						if ( event.altKey ) {
							this.openMarkdownFile( file );
						} else if ( event.shiftKey ) {
							this.beginEditingFromCell( cell );
						} else {
							this.navigateTo( previousFile );
						}
					} );
				} else if ( this.mode === 'sidebar' && parent ) {
					const parentFile = this.app.metadataCache.getFirstLinkpathDest( parent, file.path );
					cell.addClass( 'is-linked' );
					if ( parentFile ) {
						cell.addEventListener( 'click', ( event ) => {
							if ( event.altKey ) {
								this.openMarkdownFile( file );
							} else {
								this.navigateTo( parentFile );
							}
						} );
					}
				}
				continue;
			}

			const property = `mandala_${ position }`;
			const link = this.plugin.cleanLink( frontmatter[ property ] || '' );
			const linkedFile = link
				? this.app.metadataCache.getFirstLinkpathDest( link, file.path )
				: null;
			const linkedCache = linkedFile
				? this.app.metadataCache.getFileCache( linkedFile )
				: null;
			const linkedFrontmatter = linkedCache && linkedCache.frontmatter
				? linkedCache.frontmatter
				: {};
			const connectionType = linkedFile
				? this.plugin.getCellConnectionType( frontmatter, position, linkedFile )
				: '';
			const linkedRole = String( linkedFrontmatter.mandala_role || '' )
				.trim()
				.toLowerCase();
			const linkedIsMandalaRoot = linkedFile instanceof TFile
				&& ( linkedRole === 'root' || this.plugin.isLegacyRootFile( linkedFile ) );
			if ( ! linkedFile ) {
				this.registerEmptyCellDrop( cell, file, position );
			}

			if ( this.editingPosition === position ) {
				cell.addClass( 'is-editing' );
				const noteEditor = cell.createEl( 'h3', {
					text: linkedFile ? this.plugin.getMandalaTitle( linkedFile ) : '',
					cls: 'mandala-engine-cell__note-editor',
					attr: {
						contenteditable: 'true',
						'data-placeholder': 'タイトル',
						spellcheck: 'false',
					},
				} );
				noteEditor.addEventListener( 'keydown', ( event ) => {
					if ( event.key === 'Enter' ) {
						if ( event.isComposing || event.keyCode === 229 ) {
							return;
						}
						event.preventDefault();
						summaryEditor.focus();
					}
				} );

				const summaryEditor = cell.createEl( 'p', {
					text: linkedFrontmatter.mandala_summary
						? String( linkedFrontmatter.mandala_summary )
						: '',
					cls: 'mandala-engine-cell__summary-editor',
					attr: {
						contenteditable: 'true',
						'data-placeholder': '要約文',
					},
				} );

				const actions = cell.createDiv( 'mandala-engine-cell__actions' );
				const save = actions.createEl( 'button', {
					text: '保存',
					cls: 'mod-cta',
				} );
				save.addEventListener( 'click', () => this.saveCurrentEditing() );

				const clear = actions.createEl( 'button', { text: '解除' } );
				clear.disabled = ! link;
				clear.addEventListener( 'click', () => {
					if ( ! linkedFile ) {
						return;
					}
					new DeleteLinkedFileModal(
						this.app,
						this.plugin,
						linkedFile,
						connectionType,
						async () => {
							this.editingPosition = null;
							this.editMode = false;
							this.editingInitial = null;
							await this.plugin.clearCell( file, position );
						}
					).open();
				} );
				continue;
			}

			this.registerCellReorder( cell, file, position, linkedFile );

			if ( linkedFile ) {
				if ( connectionType === 'reference' && ! linkedIsMandalaRoot ) {
					cell.addClass( 'is-reference-document' );
					this.createReferenceTitle(
						cell,
						linkedFile,
						this.plugin.getMandalaTitle( linkedFile )
					);
				} else {
					cell.createEl( 'h3', { text: this.plugin.getMandalaTitle( linkedFile ) } );
				}
				if ( linkedFrontmatter.mandala_summary ) {
					cell.createEl( 'p', { text: String( linkedFrontmatter.mandala_summary ) } );
				}
				cell.addClass( 'is-linked' );
			} else {
				cell.addClass( 'is-empty' );
			}
			cell.dataset.canEdit = 'true';
			cell.dataset.editTitle = linkedFile ? this.plugin.getMandalaTitle( linkedFile ) : '';
			cell.dataset.editSummary = linkedFrontmatter.mandala_summary
				? String( linkedFrontmatter.mandala_summary )
				: '';
			cell.setAttr( 'tabindex', '0' );

			cell.addEventListener( 'click', async ( event ) => {
				if ( this.suppressCellClick ) {
					return;
				}
				if ( event.shiftKey || ! linkedFile ) {
					await this.beginEditingFromCell( cell );
					return;
				}

				if ( linkedFile ) {
					if ( event.altKey ) {
						await this.openMarkdownFile( linkedFile );
					} else {
						await this.navigateTo( linkedFile );
					}
				}
			} );
			cell.addEventListener( 'keydown', async ( event ) => {
				if ( event.key === 'Enter' && ! event.metaKey && ! event.ctrlKey ) {
					event.preventDefault();
					if ( linkedFile ) {
						await this.navigateTo( linkedFile );
					} else {
						await this.beginEditingFromCell( cell );
					}
				}
			} );
			let longPressTimer = null;
			cell.addEventListener( 'touchstart', () => {
				longPressTimer = setTimeout( async () => {
					longPressTimer = null;
					this.suppressCellClick = true;
					await this.beginEditingFromCell( cell );
					setTimeout( () => {
						this.suppressCellClick = false;
					}, 750 );
				}, 550 );
			}, { passive: true } );
			for ( const eventName of [ 'touchend', 'touchmove', 'touchcancel' ] ) {
				cell.addEventListener( eventName, () => {
					if ( longPressTimer ) {
						clearTimeout( longPressTimer );
						longPressTimer = null;
					}
				}, { passive: true } );
			}
		}

		for ( const cell of grid.querySelectorAll( '.mandala-engine-cell:not(.is-editing)' ) ) {
			if ( cell.scrollHeight > cell.clientHeight + 1 ) {
				cell.addClass( 'has-vertical-scroll' );
			}
		}

	}
}

module.exports = class MandalaEnginePlugin extends Plugin {
	async onload() {
		this.settings = Object.assign( {}, DEFAULT_SETTINGS, await this.loadData() );
		this.metadataCheckedPaths = new Set();
		this.rootAutoOpenBypassPaths = new Set();
		this.rootAutoOpeningPaths = new Set();
		this.cellOperationHistory = [];
		this.explorerContextPath = '';
		this.explorerRootPath = '';
		this.explorerOwnerLeaf = null;
		this.registerView( VIEW_TYPE, ( leaf ) => new MandalaEngineView( leaf, this ) );
		this.registerView(
			EXPLORER_VIEW_TYPE,
			( leaf ) => new MandalaExplorerView( leaf, this )
		);
		this.addSettingTab( new MandalaEngineSettingTab( this.app, this ) );

		this.addRibbonIcon( 'layout-grid', 'Open Mandala Engine', () => {
			this.activateMainView();
		} );
		this.addRibbonIcon( 'list-tree', 'Open Mandala Explorer', () => {
			this.activateExplorerView();
		} );

		this.addCommand( {
			id: 'open-mandala-engine-main',
			name: 'Open Mandala in main workspace',
			callback: () => this.activateMainView(),
		} );

		this.addCommand( {
			id: 'open-mandala-engine-sidebar',
			name: 'Open Mandala in sidebar',
			callback: () => this.activateSidebarView(),
		} );

		this.addCommand( {
			id: 'open-mandala-explorer',
			name: 'Open Mandala Explorer in sidebar',
			callback: () => this.activateExplorerView(),
		} );

		this.addCommand( {
			id: 'undo-last-mandala-cell-operation',
			name: 'Undo last Mandala cell move or swap',
			checkCallback: ( checking ) => {
				const canUndo = this.cellOperationHistory.length > 0;
				if ( canUndo && ! checking ) {
					void this.undoLastCellOperation();
				}
				return canUndo;
			},
		} );

		this.registerEvent( this.app.workspace.on( 'file-open', ( file ) => {
			void this.handleRootFileOpen( file, null ).catch( ( error ) => {
				console.error( 'Mandala Engine note auto-open failed:', error );
				new Notice( 'MandalaノートをMandala Engineで開けませんでした。' );
			} );
		} ) );

		this.registerEvent( this.app.workspace.on( 'active-leaf-change', ( leaf ) => {
			const file = leaf && leaf.view ? leaf.view.file : null;
			void this.handleRootFileOpen( file, leaf ).catch( ( error ) => {
				console.error( 'Mandala Engine active note auto-open failed:', error );
				new Notice( 'MandalaノートをMandala Engineで開けませんでした。' );
			} );
		} ) );
	}

	async onunload() {
		this.app.workspace.detachLeavesOfType( VIEW_TYPE );
		this.app.workspace.detachLeavesOfType( EXPLORER_VIEW_TYPE );
	}

	isMandalaStructureFile( file ) {
		if ( ! ( file instanceof TFile ) || file.extension !== 'md' ) {
			return false;
		}
		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const role = String( frontmatter.mandala_role || '' ).trim().toLowerCase();
		if ( role === 'root' || role === 'child' || this.isLegacyRootFile( file ) ) {
			return true;
		}
		for ( let position = 1; position <= 8; position += 1 ) {
			if ( this.cleanLink( frontmatter[ `mandala_${ position }` ] || '' ) ) {
				return true;
			}
		}
		return false;
	}

	setExplorerContext( file, rootFile = null, ownerLeaf = null ) {
		if ( ! ( file instanceof TFile ) || ! this.isMandalaStructureFile( file ) ) {
			return;
		}
		this.explorerContextPath = file.path;
		const resolvedRoot = rootFile instanceof TFile
			? rootFile
			: this.getMandalaRootFile( file );
		this.explorerRootPath = resolvedRoot instanceof TFile ? resolvedRoot.path : '';
		if (
			ownerLeaf
			&& ownerLeaf.view instanceof MandalaEngineView
			&& ownerLeaf.view.mode === 'main'
		) {
			this.explorerOwnerLeaf = ownerLeaf;
		}
		for ( const leaf of this.app.workspace.getLeavesOfType( EXPLORER_VIEW_TYPE ) ) {
			if ( leaf.view && typeof leaf.view.setSourceFile === 'function' ) {
				leaf.view.setSourceFile( file, resolvedRoot );
			}
		}
	}

	setExplorerSelection( file ) {
		if ( ! ( file instanceof TFile ) ) {
			return;
		}
		for ( const leaf of this.app.workspace.getLeavesOfType( EXPLORER_VIEW_TYPE ) ) {
			if ( leaf.view && typeof leaf.view.setSelectedFile === 'function' ) {
				leaf.view.setSelectedFile( file );
			}
		}
	}

	getExplorerContextFile() {
		const activeLeaf = this.app.workspace.activeLeaf;
		if (
			activeLeaf
			&& activeLeaf.view instanceof MandalaEngineView
			&& activeLeaf.view.mode === 'main'
		) {
			const currentFile = activeLeaf.view.getCurrentFile();
			if ( currentFile instanceof TFile ) {
				return currentFile;
			}
		}
		const activeFile = this.app.workspace.getActiveFile();
		if ( activeFile instanceof TFile && this.isMandalaStructureFile( activeFile ) ) {
			return activeFile;
		}
		const remembered = this.explorerContextPath
			? this.app.vault.getAbstractFileByPath( this.explorerContextPath )
			: null;
		return remembered instanceof TFile ? remembered : null;
	}

	async activateExplorerView() {
		let leaf = this.app.workspace.getLeavesOfType( EXPLORER_VIEW_TYPE )[ 0 ];
		if ( ! leaf ) {
			leaf = this.app.workspace.getRightLeaf( false );
			await leaf.setViewState( {
				type: EXPLORER_VIEW_TYPE,
				active: true,
				state: {
					sourcePath: this.getExplorerContextFile()?.path || '',
					rootPath: this.explorerRootPath,
				},
			} );
		}
		this.app.workspace.revealLeaf( leaf );
	}

	async openFileFromExplorer( file, treePath = [] ) {
		const mainLeaves = this.app.workspace.getLeavesOfType( VIEW_TYPE ).filter(
			( candidate ) => candidate.view && candidate.view.mode === 'main'
		);
		let leaf = mainLeaves.find(
			( candidate ) => candidate === this.explorerOwnerLeaf
		) || mainLeaves.find( ( candidate ) => (
			candidate.view
			&& Array.isArray( candidate.view.track )
			&& candidate.view.track[ 0 ] === this.explorerRootPath
		) );
		if ( leaf && leaf.view instanceof MandalaEngineView ) {
			await leaf.view.navigateToTrack( file, treePath );
			this.explorerOwnerLeaf = leaf;
			const trackRoot = leaf.view.track.length
				? this.app.vault.getAbstractFileByPath( leaf.view.track[ 0 ] )
				: null;
			this.setExplorerContext( file, trackRoot, leaf );
			this.app.workspace.setActiveLeaf( leaf, { focus: true } );
			return;
		}
		if ( ! leaf ) {
			leaf = this.app.workspace.getLeaf( 'tab' );
		}
		await this.openMandalaForFile( file, leaf, false );
		this.setExplorerContext( file, null, leaf );
	}

	async openReferenceFromExplorer( file ) {
		this.setExplorerSelection( file );
		this.bypassNextRootAutoOpen( file );
		const leaf = this.app.workspace.getLeaf( 'tab' );
		await leaf.openFile( file );
		this.app.workspace.revealLeaf( leaf );
	}

	async setCellColorMode( mode ) {
		this.settings.cellColorMode = [ 'odd-gray', 'even-gray' ].includes( mode )
			? mode
			: 'all-white';
		await this.saveData( this.settings );
		await this.refreshViews();
	}

	async setThemeMode( mode ) {
		this.settings.themeMode = [ 'auto', 'light', 'dark' ].includes( mode )
			? mode
			: 'auto';
		await this.saveData( this.settings );
		await this.refreshViews();
	}

	async setAutoOpenRootNotes( enabled ) {
		this.settings.autoOpenRootNotes = Boolean( enabled );
		await this.saveData( this.settings );
	}

	bypassNextRootAutoOpen( file ) {
		if ( ! ( file instanceof TFile ) ) {
			return;
		}
		this.rootAutoOpenBypassPaths.add( file.path );
		setTimeout( () => {
			this.rootAutoOpenBypassPaths.delete( file.path );
		}, 2000 );
	}

	async handleRootFileOpen( file, preferredLeaf = null ) {
		if (
			! this.settings.autoOpenRootNotes
			|| ! ( file instanceof TFile )
			|| file.extension !== 'md'
		) {
			return;
		}
		if ( this.rootAutoOpenBypassPaths.has( file.path ) ) {
			return;
		}

		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const role = String( frontmatter.mandala_role || '' ).trim().toLowerCase();
		const canAutoOpen = role === 'root'
			|| ( this.isInMandalaFolder( file ) && role === 'child' );
		if ( ! canAutoOpen ) {
			return;
		}
		if ( this.rootAutoOpeningPaths.has( file.path ) ) {
			return;
		}

		let leaf = null;
		for ( let attempt = 0; attempt < 8; attempt += 1 ) {
			const candidates = [ preferredLeaf, this.app.workspace.activeLeaf ];
			leaf = candidates.find( ( candidate ) => {
				const candidateFile = candidate && candidate.view ? candidate.view.file : null;
				return candidate
					&& candidate.view.getViewType() === 'markdown'
					&& candidateFile instanceof TFile
					&& candidateFile.path === file.path;
			} ) || null;
			if ( leaf ) {
				break;
			}
			await new Promise( ( resolve ) => setTimeout( resolve, 25 ) );
		}
		if ( ! leaf ) {
			return;
		}
		if ( this.rootAutoOpeningPaths.has( file.path ) ) {
			return;
		}

		this.rootAutoOpeningPaths.add( file.path );
		try {
			await this.openMandalaForFile( file, leaf, false );
			this.activateMandalaLeafAfterTransition( leaf, file );
		} finally {
			this.rootAutoOpeningPaths.delete( file.path );
		}
	}

	activateMandalaLeafAfterTransition( leaf, file ) {
		if ( ! leaf || ! ( file instanceof TFile ) ) {
			return;
		}
		const activateIfCurrent = () => {
			if (
				leaf.view instanceof MandalaEngineView
				&& leaf.view.mode === 'main'
				&& leaf.view.getCurrentFile()?.path === file.path
			) {
				this.app.workspace.setActiveLeaf( leaf, { focus: true } );
			}
		};
		const ownerWindow = this.app.workspace.containerEl?.ownerDocument?.defaultView;
		if ( ! ownerWindow ) {
			activateIfCurrent();
			return;
		}
		// Obsidian finishes the original Markdown-link activation after file-open.
		// Activate the converted Mandala once, after that transition has settled.
		ownerWindow.setTimeout( activateIfCurrent, 60 );
	}

	hasValidMandalaTrackRoot( track ) {
		const rootPath = Array.isArray( track ) && track.length ? track[ 0 ] : '';
		const rootFile = rootPath
			? this.app.vault.getAbstractFileByPath( rootPath )
			: null;
		if ( ! ( rootFile instanceof TFile ) ) {
			return false;
		}
		const cache = this.app.metadataCache.getFileCache( rootFile );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		return String( frontmatter.mandala_role || '' ).trim().toLowerCase() === 'root';
	}

	async restoreLeafAsMarkdown( leaf, file ) {
		this.bypassNextRootAutoOpen( file );
		await leaf.setViewState( {
			type: 'markdown',
			active: true,
			state: { file: file.path },
		} );
		this.app.workspace.revealLeaf( leaf );
	}

	async openMandalaForFile( file, leaf, initialize = false ) {
		if ( initialize ) {
			await this.ensureMandalaMetadata( [ file ], true );
			await this.renameMandalaFileToTitle( file, this.getMandalaTitle( file ) );
		}
		const initialTrack = this.getParentTrack( file );
		await leaf.setViewState( {
			type: VIEW_TYPE,
			active: true,
			state: {
				mode: 'main',
				sourcePath: file.path,
				track: initialTrack,
				explicitOpen: initialize,
			},
		} );
		this.app.workspace.revealLeaf( leaf );
	}

	async activateMainView() {
		const file = this.app.workspace.getActiveFile();
		if ( ! file || file.extension !== 'md' ) {
			new Notice( 'Open a Markdown note first.' );
			return;
		}

		const activeLeaf = this.app.workspace.activeLeaf;
		const activeLeafFile = activeLeaf && activeLeaf.view
			? activeLeaf.view.file
			: null;
		const leaf = activeLeaf
			&& activeLeaf.view.getViewType() === 'markdown'
			&& activeLeafFile instanceof TFile
			&& activeLeafFile.path === file.path
				? activeLeaf
				: this.app.workspace.getLeaf( true );
		await this.openMandalaForFile( file, leaf, true );
	}

	async activateSidebarView() {
		let leaf = this.app.workspace.getLeavesOfType( VIEW_TYPE ).find(
			( candidate ) => candidate.view && candidate.view.mode === 'sidebar'
		);
		if ( ! leaf ) {
			leaf = this.app.workspace.getRightLeaf( false );
			await leaf.setViewState( {
				type: VIEW_TYPE,
				active: true,
				state: { mode: 'sidebar' },
			} );
		}
		this.app.workspace.revealLeaf( leaf );
	}

	cleanLink( value ) {
		return String( value || '' )
			.replace( /^\[\[/, '' )
			.replace( /\]\]$/, '' )
			.split( '|' )[ 0 ]
			.trim();
	}

	getParentTrack( file ) {
		const trackFromCurrent = [];
		const visited = new Set();
		let currentFile = file;

		while ( currentFile instanceof TFile && trackFromCurrent.length < 100 ) {
			if ( visited.has( currentFile.path ) ) {
				return [ file.path ];
			}
			visited.add( currentFile.path );
			trackFromCurrent.push( currentFile.path );

			const cache = this.app.metadataCache.getFileCache( currentFile );
			const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
			const parentLink = this.getMandalaParentLink( frontmatter, currentFile );
			if ( ! parentLink ) {
				break;
			}

			const parentFile = this.app.metadataCache.getFirstLinkpathDest(
				parentLink,
				currentFile.path
			);
			if ( ! ( parentFile instanceof TFile ) || parentFile.extension !== 'md' ) {
				break;
			}
			currentFile = parentFile;
		}

		if ( trackFromCurrent.length >= 100 ) {
			return [ file.path ];
		}
		return trackFromCurrent.reverse();
	}

	getMandalaTitle( file ) {
		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		return String( frontmatter.mandala_title || file.basename ).trim();
	}

	async waitForFileMetadata( file, predicate, timeout = 1000 ) {
		const startedAt = Date.now();
		while ( Date.now() - startedAt < timeout ) {
			const cache = this.app.metadataCache.getFileCache( file );
			const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
			if ( predicate( frontmatter ) ) {
				return true;
			}
			await new Promise( ( resolve ) => setTimeout( resolve, 25 ) );
		}
		return false;
	}

	isLegacyRootFile( file ) {
		return file instanceof TFile
			&& /^mandala_.+_0 \d{4}-\d{2}-\d{2}(?:_\d+)?$/.test( file.basename );
	}

	getMandalaRoleFromFrontmatter( frontmatter, file = null ) {
		const role = String( frontmatter.mandala_role || '' ).trim().toLowerCase();
		if ( role === 'root' || role === 'child' ) {
			return role;
		}
		if ( this.isLegacyRootFile( file ) ) {
			return 'root';
		}
		return this.cleanLink( frontmatter.mandala_parent || '' ) ? 'child' : 'root';
	}

	getMandalaRole( file ) {
		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		return this.getMandalaRoleFromFrontmatter( frontmatter, file );
	}

	getMandalaParentLink( frontmatter, file = null ) {
		return this.getMandalaRoleFromFrontmatter( frontmatter, file ) === 'child'
			? this.cleanLink( frontmatter.mandala_parent || '' )
			: '';
	}

	getCellConnectionType( frontmatter, position, linkedFile = null ) {
		const type = String( frontmatter[ `mandala_${ position }_type` ] || '' )
			.trim()
			.toLowerCase();
		if ( type === 'child' || type === 'reference' ) {
			return type;
		}
		if ( linkedFile instanceof TFile ) {
			const linkedCache = this.app.metadataCache.getFileCache( linkedFile );
			const linkedFrontmatter = linkedCache && linkedCache.frontmatter
				? linkedCache.frontmatter
				: {};
			const linkedRole = String( linkedFrontmatter.mandala_role || '' )
				.trim()
				.toLowerCase();
			if ( linkedRole === 'child' || linkedFile.basename.startsWith( 'mandala_' ) ) {
				return 'child';
			}
		}
		return 'reference';
	}

	findCellPositionLinkingTo( sourceFile, linkedFile ) {
		if ( ! ( sourceFile instanceof TFile ) || ! ( linkedFile instanceof TFile ) ) {
			return -1;
		}
		const cache = this.app.metadataCache.getFileCache( sourceFile );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		for ( let position = 1; position <= 8; position += 1 ) {
			const link = this.cleanLink( frontmatter[ `mandala_${ position }` ] || '' );
			if ( ! link ) {
				continue;
			}
			const candidate = this.app.metadataCache.getFirstLinkpathDest(
				link,
				sourceFile.path
			);
			if ( candidate instanceof TFile && candidate.path === linkedFile.path ) {
				return position;
			}
		}
		return -1;
	}

	isFileWithinMandalaBranch( candidateFile, branchRootFile ) {
		if ( ! ( candidateFile instanceof TFile ) || ! ( branchRootFile instanceof TFile ) ) {
			return false;
		}
		const visited = new Set();
		const pending = [ branchRootFile ];
		while ( pending.length ) {
			const current = pending.pop();
			if ( ! ( current instanceof TFile ) || visited.has( current.path ) ) {
				continue;
			}
			if ( current.path === candidateFile.path ) {
				return true;
			}
			visited.add( current.path );
			const cache = this.app.metadataCache.getFileCache( current );
			const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
			for ( let position = 1; position <= 8; position += 1 ) {
				const link = this.cleanLink( frontmatter[ `mandala_${ position }` ] || '' );
				if ( ! link ) {
					continue;
				}
				const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
					link,
					current.path
				);
				if ( linkedFile instanceof TFile && ! visited.has( linkedFile.path ) ) {
					pending.push( linkedFile );
				}
			}
		}
		return false;
	}

	hasCompleteCellConnectionTypes( file, frontmatter ) {
		for ( let position = 1; position <= 8; position += 1 ) {
			const link = this.cleanLink( frontmatter[ `mandala_${ position }` ] || '' );
			const type = String( frontmatter[ `mandala_${ position }_type` ] || '' )
				.trim()
				.toLowerCase();
			if ( link && ! [ 'child', 'reference' ].includes( type ) ) {
				return false;
			}
			if ( ! link && type ) {
				return false;
			}
		}
		return true;
	}

	getMandalaColorMode( file ) {
		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const mode = String( frontmatter.mandala_color_mode || 'inherit' );
		return [ 'all-white', 'odd-gray', 'even-gray' ].includes( mode )
			? mode
			: 'inherit';
	}

	getMandalaRootFile( file ) {
		const visited = new Set();
		let currentFile = file;
		let rootFile = file;

		while ( currentFile instanceof TFile && ! visited.has( currentFile.path ) ) {
			visited.add( currentFile.path );
			rootFile = currentFile;
			const cache = this.app.metadataCache.getFileCache( currentFile );
			const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
			const parentLink = this.getMandalaParentLink( frontmatter, currentFile );
			if ( ! parentLink ) {
				break;
			}
			const parentFile = this.app.metadataCache.getFirstLinkpathDest(
				parentLink,
				currentFile.path
			);
			if ( ! ( parentFile instanceof TFile ) || parentFile.extension !== 'md' ) {
				break;
			}
			currentFile = parentFile;
		}

		return rootFile;
	}

	getMandalaThemeMode( file ) {
		const rootFile = this.getMandalaRootFile( file );
		const cache = this.app.metadataCache.getFileCache( rootFile );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const mode = String( frontmatter.mandala_theme || 'inherit' ).trim().toLowerCase();
		return [ 'auto', 'light', 'dark' ].includes( mode ) ? mode : 'inherit';
	}

	getEffectiveMandalaThemeMode( file ) {
		const mode = this.getMandalaThemeMode( file );
		return mode === 'inherit' ? this.settings.themeMode : mode;
	}

	resolveMandalaTheme( mode ) {
		if ( mode === 'light' || mode === 'dark' ) {
			return mode;
		}
		const body = this.app.workspace.containerEl.ownerDocument.body;
		return body && body.classList.contains( 'theme-dark' ) ? 'dark' : 'light';
	}

	getThemeModeLabel( mode, resolvedMode = this.resolveMandalaTheme( mode ) ) {
		if ( mode === 'auto' ) {
			return `自動（${ resolvedMode === 'dark' ? 'ダーク' : 'ライト' }）`;
		}
		return mode === 'dark' ? 'ダーク' : 'ライト';
	}

	async setMandalaRootTheme( file, mode ) {
		const cleanMode = [ 'inherit', 'auto', 'light', 'dark' ].includes( mode )
			? mode
			: 'inherit';
		const rootFile = this.getMandalaRootFile( file );
		await this.app.fileManager.processFrontMatter( rootFile, ( frontmatter ) => {
			frontmatter.mandala_theme = cleanMode;
		} );
		await this.refreshViews();
	}

	getHexColor( value, fallback ) {
		const color = String( value || '' ).trim().toLowerCase();
		return /^#[0-9a-f]{6}$/.test( color ) ? color : fallback;
	}

	getMandalaColors( file, resolvedTheme = 'light' ) {
		const rootFile = this.getMandalaRootFile( file );
		const cache = this.app.metadataCache.getFileCache( rootFile );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const backgroundFallback = resolvedTheme === 'dark'
			? DEFAULT_DARK_BACKGROUND_COLOR
			: DEFAULT_BACKGROUND_COLOR;
		const grayCellFallback = resolvedTheme === 'dark'
			? DEFAULT_DARK_GRAY_CELL_COLOR
			: DEFAULT_GRAY_CELL_COLOR;
		return {
			background: this.getHexColor(
				frontmatter.mandala_background_color,
				backgroundFallback
			),
			grayCell: this.getHexColor(
				frontmatter.mandala_gray_cell_color,
				grayCellFallback
			),
			hasCustomBackground: Boolean(
				this.getHexColor( frontmatter.mandala_background_color, '' )
			),
			hasCustomGrayCell: Boolean(
				this.getHexColor( frontmatter.mandala_gray_cell_color, '' )
			),
		};
	}

	async setMandalaRootColor( file, property, color ) {
		if ( ! [ 'mandala_background_color', 'mandala_gray_cell_color' ].includes( property ) ) {
			return;
		}
		const cleanColor = this.getHexColor( color, '' );
		if ( ! cleanColor ) {
			new Notice( '色を保存できませんでした。' );
			return;
		}
		const rootFile = this.getMandalaRootFile( file );
		await this.app.fileManager.processFrontMatter( rootFile, ( frontmatter ) => {
			frontmatter[ property ] = cleanColor;
		} );
		await this.refreshViews();
	}

	async resetMandalaRootColors( file ) {
		const rootFile = this.getMandalaRootFile( file );
		await this.app.fileManager.processFrontMatter( rootFile, ( frontmatter ) => {
			delete frontmatter.mandala_background_color;
			delete frontmatter.mandala_gray_cell_color;
		} );
		await this.refreshViews();
	}

	getMandalaBackgroundImage( file ) {
		const rootFile = this.getMandalaRootFile( file );
		const cache = this.app.metadataCache.getFileCache( rootFile );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const link = this.cleanLink( frontmatter.mandala_background_image || '' );
		const exactFile = link ? this.app.vault.getAbstractFileByPath( link ) : null;
		const imageFile = exactFile instanceof TFile
			? exactFile
			: link
				? this.app.metadataCache.getFirstLinkpathDest( link, rootFile.path )
				: null;
		const rawOpacity = Number( frontmatter.mandala_background_image_opacity );
		const opacity = Number.isFinite( rawOpacity )
			? Math.min( 1, Math.max( 0.1, rawOpacity ) )
			: 0.3;
		return {
			file: imageFile instanceof TFile ? imageFile : null,
			opacity,
		};
	}

	async setMandalaBackgroundImage( file, imageFile ) {
		if ( ! ( imageFile instanceof TFile ) ) {
			return;
		}
		const rootFile = this.getMandalaRootFile( file );
		await this.app.fileManager.processFrontMatter( rootFile, ( frontmatter ) => {
			frontmatter.mandala_background_image = `[[${ imageFile.path }]]`;
			if ( ! Number.isFinite( Number( frontmatter.mandala_background_image_opacity ) ) ) {
				frontmatter.mandala_background_image_opacity = 0.3;
			}
		} );
		await this.waitForFileMetadata( rootFile, ( frontmatter ) => (
			this.cleanLink( frontmatter.mandala_background_image || '' ) === imageFile.path
		) );
		new Notice( `背景画像を「${ imageFile.name }」に設定しました。` );
		await this.refreshViews();
	}

	async setMandalaBackgroundImageOpacity( file, opacity ) {
		const cleanOpacity = Math.min( 1, Math.max( 0.1, Number( opacity ) || 0.3 ) );
		const rootFile = this.getMandalaRootFile( file );
		await this.app.fileManager.processFrontMatter( rootFile, ( frontmatter ) => {
			if ( frontmatter.mandala_background_image ) {
				frontmatter.mandala_background_image_opacity = Number(
					cleanOpacity.toFixed( 2 )
				);
			}
		} );
		await this.waitForFileMetadata( rootFile, ( frontmatter ) => (
			Math.abs(
				Number( frontmatter.mandala_background_image_opacity ) - cleanOpacity
			) < 0.011
		) );
		await this.refreshViews();
	}

	async clearMandalaBackgroundImage( file ) {
		const rootFile = this.getMandalaRootFile( file );
		await this.app.fileManager.processFrontMatter( rootFile, ( frontmatter ) => {
			delete frontmatter.mandala_background_image;
			delete frontmatter.mandala_background_image_opacity;
		} );
		await this.waitForFileMetadata( rootFile, ( frontmatter ) => (
			! frontmatter.mandala_background_image
		) );
		new Notice( '背景画像を解除しました。' );
		await this.refreshViews();
	}

	getEffectiveCellColorMode( file ) {
		const visited = new Set();
		let currentFile = file;

		while ( currentFile instanceof TFile && ! visited.has( currentFile.path ) ) {
			visited.add( currentFile.path );
			const mode = this.getMandalaColorMode( currentFile );
			if ( mode !== 'inherit' ) {
				return mode;
			}

			const cache = this.app.metadataCache.getFileCache( currentFile );
			const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
			const parentLink = this.getMandalaParentLink( frontmatter, currentFile );
			if ( ! parentLink ) {
				break;
			}
			const parentFile = this.app.metadataCache.getFirstLinkpathDest(
				parentLink,
				currentFile.path
			);
			if ( ! ( parentFile instanceof TFile ) ) {
				break;
			}
			currentFile = parentFile;
		}

		return this.settings.cellColorMode;
	}

	getColorModeLabel( mode ) {
		return {
			'all-white': 'すべて白',
			'odd-gray': '1・3・5・7',
			'even-gray': '2・4・6・8',
		}[ mode ] || 'すべて白';
	}

	async setMandalaColorMode( file, mode ) {
		const cleanMode = [ 'inherit', 'all-white', 'odd-gray', 'even-gray' ].includes( mode )
			? mode
			: 'inherit';
		await this.app.fileManager.processFrontMatter( file, ( frontmatter ) => {
			frontmatter.mandala_color_mode = cleanMode;
		} );
		await this.refreshViews();
	}

	hasMandalaCategory( categories ) {
		const values = Array.isArray( categories ) ? categories : [ categories ];
		return values.some(
			( value ) => this.cleanLink( value ).toLowerCase() === 'mandala'
		);
	}

	async ensureMandalaMetadata( files, force = false ) {
		for ( const file of files ) {
			if (
				! ( file instanceof TFile )
				|| ( ! force && this.metadataCheckedPaths.has( file.path ) )
			) {
				continue;
			}

			const cache = this.app.metadataCache.getFileCache( file );
			const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
			const hasTitle = typeof frontmatter.mandala_title === 'string'
				&& frontmatter.mandala_title.trim();
			const hasCategory = this.hasMandalaCategory( frontmatter.categories );
			const hasCreated = Boolean( frontmatter.created );
			const hasColorMode = Boolean( frontmatter.mandala_color_mode );
			const hasRole = [ 'root', 'child' ].includes(
				String( frontmatter.mandala_role || '' ).trim().toLowerCase()
			);
			const hasTheme = String( frontmatter.mandala_role || '' ).trim().toLowerCase() !== 'root'
				|| [ 'inherit', 'auto', 'light', 'dark' ].includes(
					String( frontmatter.mandala_theme || '' ).trim().toLowerCase()
				);
			const hasStaleRootParent = String( frontmatter.mandala_role || '' )
				.trim()
				.toLowerCase() === 'root'
				&& Boolean( this.cleanLink( frontmatter.mandala_parent || '' ) );
			const hasCellTypes = this.hasCompleteCellConnectionTypes( file, frontmatter );
			if (
				hasTitle
				&& hasCategory
				&& hasCreated
				&& hasColorMode
				&& hasRole
				&& hasTheme
				&& ! hasStaleRootParent
				&& hasCellTypes
			) {
				this.metadataCheckedPaths.add( file.path );
				continue;
			}

			this.metadataCheckedPaths.add( file.path );
			try {
				await this.app.fileManager.processFrontMatter( file, ( metadata ) => {
					metadata.mandala_role = this.getMandalaRoleFromFrontmatter( metadata, file );
					if ( metadata.mandala_role === 'root' ) {
						delete metadata.mandala_parent;
						if ( ! [ 'inherit', 'auto', 'light', 'dark' ].includes(
							String( metadata.mandala_theme || '' ).trim().toLowerCase()
						) ) {
							metadata.mandala_theme = 'inherit';
						}
					}
					for ( let position = 1; position <= 8; position += 1 ) {
						const property = `mandala_${ position }`;
						const typeProperty = `${ property }_type`;
						const link = this.cleanLink( metadata[ property ] || '' );
						if ( ! link ) {
							delete metadata[ typeProperty ];
							continue;
						}
						const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
							link,
							file.path
						);
						metadata[ typeProperty ] = this.getCellConnectionType(
							metadata,
							position,
							linkedFile
						);
					}
					if ( ! metadata.mandala_title ) {
						metadata.mandala_title = file.basename;
					}
					if ( ! metadata.created ) {
						metadata.created = this.getLocalDate();
					}
					if ( ! metadata.mandala_color_mode ) {
						metadata.mandala_color_mode = 'inherit';
					}

					if ( ! this.hasMandalaCategory( metadata.categories ) ) {
						const categories = Array.isArray( metadata.categories )
							? metadata.categories
							: metadata.categories
								? [ metadata.categories ]
								: [];
						categories.push( '[[mandala]]' );
						metadata.categories = categories;
					}
				} );
			} catch ( error ) {
				this.metadataCheckedPaths.delete( file.path );
				console.error( 'Mandala Engine metadata update failed:', error );
				if ( force ) {
					new Notice( 'Mandalaプロパティを追加できませんでした。' );
				}
			}
		}
	}

	getLocalDate() {
		const now = new Date();
		const year = String( now.getFullYear() );
		const month = String( now.getMonth() + 1 ).padStart( 2, '0' );
		const day = String( now.getDate() ).padStart( 2, '0' );
		return `${ year }-${ month }-${ day }`;
	}

	getDateString( value ) {
		if ( value instanceof Date && ! Number.isNaN( value.getTime() ) ) {
			const year = String( value.getFullYear() );
			const month = String( value.getMonth() + 1 ).padStart( 2, '0' );
			const day = String( value.getDate() ).padStart( 2, '0' );
			return `${ year }-${ month }-${ day }`;
		}

		const match = String( value || '' ).match( /\d{4}-\d{2}-\d{2}/ );
		return match ? match[ 0 ] : this.getLocalDate();
	}

	getSafeFilePart( value, maxLength = 70 ) {
		const safe = String( value || '' )
			.replace( /[\\/:*?"<>|#[\]]/g, '-' )
			.replace( /\s+/g, ' ' )
			.trim()
			.replace( /[. ]+$/, '' );
		return safe.slice( 0, maxLength ) || 'untitled';
	}

	isInMandalaFolder( file ) {
		return file instanceof TFile && file.parent?.path === MANDALA_FOLDER;
	}

	async ensureMandalaFolder() {
		const existing = this.app.vault.getAbstractFileByPath( MANDALA_FOLDER );
		if ( existing instanceof TFolder ) {
			return existing;
		}
		if ( existing ) {
			throw new Error( `「${ MANDALA_FOLDER }」というファイルが既にあります。` );
		}
		return this.app.vault.createFolder( MANDALA_FOLDER );
	}

	getAvailableMandalaPath( file, title ) {
		const base = this.getSafeFilePart( title, 100 );
		let path = `${ MANDALA_FOLDER }/${ base }.md`;
		let suffix = 2;
		while ( path !== file?.path && this.app.vault.getAbstractFileByPath( path ) ) {
			path = `${ MANDALA_FOLDER }/${ base } ${ suffix }.md`;
			suffix += 1;
		}
		return path;
	}

	getMandalaLink( file ) {
		return file instanceof TFile
			? `[[${ file.path.replace( /\.md$/i, '' ) }]]`
			: '';
	}

	async renameMandalaFileToTitle( file, title ) {
		if ( ! ( file instanceof TFile ) ) {
			return file;
		}
		await this.ensureMandalaFolder();
		const oldPath = file.path;
		const newPath = this.getAvailableMandalaPath( file, title );
		if ( newPath !== oldPath ) {
			await this.app.fileManager.renameFile( file, newPath );
			this.metadataCheckedPaths.delete( oldPath );
			this.metadataCheckedPaths.add( file.path );
			this.updateViewPaths( oldPath, file.path );
		}
		return file;
	}

	async clearCell( sourceFile, position ) {
		await this.app.fileManager.processFrontMatter( sourceFile, ( frontmatter ) => {
			delete frontmatter[ `mandala_${ position }` ];
			delete frontmatter[ `mandala_${ position }_type` ];
		} );
		new Notice( 'Connection cleared.' );
		await this.refreshViews();
	}

	isTrashableMandalaFile( file ) {
		if ( ! ( file instanceof TFile ) || file.extension !== 'md' ) {
			return false;
		}
		if ( file.basename.startsWith( 'mandala_' ) ) {
			return true;
		}
		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		return this.isInMandalaFolder( file )
			&& String( frontmatter.mandala_role || '' ).trim().toLowerCase() === 'child';
	}

	getMandalaBranchDeletePlan( branchFile ) {
		if ( ! this.isTrashableMandalaFile( branchFile ) ) {
			return [];
		}

		const visited = new Set();
		const deletePlan = [];
		const visit = ( file ) => {
			if ( ! this.isTrashableMandalaFile( file ) || visited.has( file.path ) ) {
				return;
			}
			visited.add( file.path );

			const cache = this.app.metadataCache.getFileCache( file );
			const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
			for ( let position = 1; position <= 8; position += 1 ) {
				const link = this.cleanLink( frontmatter[ `mandala_${ position }` ] || '' );
				if ( ! link ) {
					continue;
				}
				const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
					link,
					file.path
				);
				if ( ! ( linkedFile instanceof TFile ) ) {
					continue;
				}
				const connectionType = this.getCellConnectionType(
					frontmatter,
					position,
					linkedFile
				);
				if ( connectionType === 'child' && this.isTrashableMandalaFile( linkedFile ) ) {
					visit( linkedFile );
				}
			}

			// Children are added first so a branch is removed from its leaves upward.
			deletePlan.push( file.path );
		};

		visit( branchFile );
		return deletePlan;
	}

	async trashMandalaBranch( deletePlan ) {
		const paths = Array.isArray( deletePlan ) ? deletePlan : [];
		let removedCount = 0;
		try {
			for ( const path of paths ) {
				const file = this.app.vault.getAbstractFileByPath( path );
				if ( ! ( file instanceof TFile ) ) {
					continue;
				}
				await this.app.fileManager.trashFile( file );
				this.metadataCheckedPaths.delete( path );
				removedCount += 1;
			}
			new Notice( `Mandalaファイル${ removedCount }件をゴミ箱へ移動しました。` );
			await this.refreshViews();
			return true;
		} catch ( error ) {
			console.error( 'Mandala Engine branch trash failed:', error );
			new Notice( `${ removedCount }件を移動した後、処理を完了できませんでした。` );
			await this.refreshViews();
			return false;
		}
	}

	async trashLinkedFile( file ) {
		const currentFile = this.app.vault.getAbstractFileByPath( file.path );
		if ( ! ( currentFile instanceof TFile ) ) {
			new Notice( 'ファイルは既に存在しません。' );
			return true;
		}

		try {
			await this.app.fileManager.trashFile( currentFile );
			this.metadataCheckedPaths.delete( file.path );
			new Notice( `${ file.basename }をゴミ箱へ移動しました。` );
			await this.refreshViews();
			return true;
		} catch ( error ) {
			console.error( 'Mandala Engine trash failed:', error );
			new Notice( 'ファイルをゴミ箱へ移動できませんでした。' );
			return false;
		}
	}

	async swapCells( sourceFile, fromPosition, toPosition, targetWasLinked ) {
		const sourceSnapshot = this.getCellSnapshot( sourceFile, fromPosition );
		const targetSnapshot = this.getCellSnapshot( sourceFile, toPosition );
		await this.app.fileManager.processFrontMatter( sourceFile, ( frontmatter ) => {
			const fromProperty = `mandala_${ fromPosition }`;
			const toProperty = `mandala_${ toPosition }`;
			const fromTypeProperty = `${ fromProperty }_type`;
			const toTypeProperty = `${ toProperty }_type`;
			const fromValue = frontmatter[ fromProperty ];
			const toValue = frontmatter[ toProperty ];
			const fromType = frontmatter[ fromTypeProperty ];
			const toType = frontmatter[ toTypeProperty ];

			if ( toValue ) {
				frontmatter[ fromProperty ] = toValue;
			} else {
				delete frontmatter[ fromProperty ];
			}

			if ( fromValue ) {
				frontmatter[ toProperty ] = fromValue;
			} else {
				delete frontmatter[ toProperty ];
			}

			if ( toValue && toType ) {
				frontmatter[ fromTypeProperty ] = toType;
			} else {
				delete frontmatter[ fromTypeProperty ];
			}

			if ( fromValue && fromType ) {
				frontmatter[ toTypeProperty ] = fromType;
			} else {
				delete frontmatter[ toTypeProperty ];
			}
		} );

		this.recordCellOperation( {
			sourcePath: sourceFile.path,
			fromPosition,
			sourceSnapshot,
			targetPath: sourceFile.path,
			toPosition,
			targetSnapshot,
		} );
		new Notice( targetWasLinked ? 'Cells swapped.' : 'Cell moved.' );
		await this.refreshViews();
	}

	getCellSnapshot( file, position ) {
		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const property = `mandala_${ position }`;
		const value = frontmatter[ property ] || '';
		if ( ! value ) {
			return { value: '', type: '' };
		}
		const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
			this.cleanLink( value ),
			file.path
		);
		return {
			value,
			type: frontmatter[ `${ property }_type` ]
				|| this.getCellConnectionType( frontmatter, position, linkedFile ),
		};
	}

	async applyCellSnapshot( file, position, snapshot ) {
		await this.app.fileManager.processFrontMatter( file, ( frontmatter ) => {
			const property = `mandala_${ position }`;
			const typeProperty = `${ property }_type`;
			if ( snapshot.value ) {
				frontmatter[ property ] = snapshot.value;
				frontmatter[ typeProperty ] = snapshot.type || 'reference';
			} else {
				delete frontmatter[ property ];
				delete frontmatter[ typeProperty ];
			}
		} );
	}

	recordCellOperation( operation ) {
		this.cellOperationHistory.push( operation );
		if ( this.cellOperationHistory.length > 20 ) {
			this.cellOperationHistory.shift();
		}
	}

	async undoLastCellOperation() {
		const operation = this.cellOperationHistory.pop();
		if ( ! operation ) {
			new Notice( '取り消せるセル移動はありません。' );
			return false;
		}
		const sourceFile = this.app.vault.getAbstractFileByPath( operation.sourcePath );
		const targetFile = this.app.vault.getAbstractFileByPath( operation.targetPath );
		if ( ! ( sourceFile instanceof TFile ) || ! ( targetFile instanceof TFile ) ) {
			this.cellOperationHistory.push( operation );
			new Notice( '取り消し対象のMandalaが見つかりません。' );
			return false;
		}

		const currentSource = this.getCellSnapshot( sourceFile, operation.fromPosition );
		const currentTarget = this.getCellSnapshot( targetFile, operation.toPosition );
		try {
			await this.applyCellSnapshot(
				sourceFile,
				operation.fromPosition,
				operation.sourceSnapshot
			);
			await this.applyCellSnapshot(
				targetFile,
				operation.toPosition,
				operation.targetSnapshot
			);
			await this.updateMovedChildParent(
				operation.sourceSnapshot,
				targetFile,
				sourceFile
			);
			await this.updateMovedChildParent(
				operation.targetSnapshot,
				sourceFile,
				targetFile
			);
		} catch ( error ) {
			console.error( 'Mandala Engine undo cell operation failed:', error );
			try {
				await this.applyCellSnapshot( sourceFile, operation.fromPosition, currentSource );
				await this.applyCellSnapshot( targetFile, operation.toPosition, currentTarget );
			} catch ( rollbackError ) {
				console.error( 'Mandala Engine undo rollback failed:', rollbackError );
			}
			this.cellOperationHistory.push( operation );
			new Notice( 'セル移動を取り消せませんでした。' );
			await this.refreshViews();
			return false;
		}

		new Notice( '直前のセル移動／交換を取り消しました。' );
		await this.refreshViews();
		return true;
	}

	async updateMovedChildParent( snapshot, oldParentFile, newParentFile ) {
		if ( snapshot.type !== 'child' || ! snapshot.value ) {
			return;
		}
		const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
			this.cleanLink( snapshot.value ),
			oldParentFile.path
		);
		if ( ! ( linkedFile instanceof TFile ) ) {
			return;
		}
		await this.app.fileManager.processFrontMatter( linkedFile, ( frontmatter ) => {
			const role = String( frontmatter.mandala_role || '' ).trim().toLowerCase();
			if ( role === 'root' ) {
				return;
			}
			frontmatter.mandala_role = 'child';
			frontmatter.mandala_parent = `[[${ newParentFile.basename }]]`;
		} );
	}

	async transferCellAcrossMandalas( sourceFile, fromPosition, targetFile, toPosition ) {
		const sourceSnapshot = this.getCellSnapshot( sourceFile, fromPosition );
		const targetSnapshot = this.getCellSnapshot( targetFile, toPosition );
		if ( ! sourceSnapshot.value ) {
			new Notice( '移動元のセルが空になっています。' );
			return;
		}

		try {
			await this.applyCellSnapshot( sourceFile, fromPosition, targetSnapshot );
			await this.applyCellSnapshot( targetFile, toPosition, sourceSnapshot );
			await this.updateMovedChildParent( sourceSnapshot, sourceFile, targetFile );
			await this.updateMovedChildParent( targetSnapshot, targetFile, sourceFile );
		} catch ( error ) {
			console.error( 'Mandala Engine cross-page cell transfer failed:', error );
			try {
				await this.applyCellSnapshot( sourceFile, fromPosition, sourceSnapshot );
				await this.applyCellSnapshot( targetFile, toPosition, targetSnapshot );
			} catch ( rollbackError ) {
				console.error( 'Mandala Engine cross-page rollback failed:', rollbackError );
			}
			new Notice( 'ページ間のセル移動を完了できませんでした。元の配置へ戻しました。' );
			await this.refreshViews();
			return;
		}

		this.recordCellOperation( {
			sourcePath: sourceFile.path,
			fromPosition,
			sourceSnapshot,
			targetPath: targetFile.path,
			toPosition,
			targetSnapshot,
		} );
		new Notice( targetSnapshot.value ? 'ページをまたいでセルを交換しました。' : 'ページをまたいでセルを移動しました。' );
		await this.refreshViews();
	}

	async saveRootCell( file, title, summary ) {
		const cleanTitle = String( title || '' ).trim();
		if ( ! cleanTitle ) {
			new Notice( 'タイトルを入力してください。' );
			return false;
		}

		await this.app.fileManager.processFrontMatter( file, ( frontmatter ) => {
			frontmatter.mandala_role = 'root';
			delete frontmatter.mandala_parent;
			if ( ! frontmatter.mandala_theme ) {
				frontmatter.mandala_theme = 'inherit';
			}
			frontmatter.mandala_title = cleanTitle;
			if ( summary ) {
				frontmatter.mandala_summary = summary;
			} else {
				delete frontmatter.mandala_summary;
			}
			if ( ! frontmatter.created ) {
				frontmatter.created = this.getLocalDate();
			}
			if ( ! frontmatter.mandala_color_mode ) {
				frontmatter.mandala_color_mode = 'inherit';
			}
			if ( ! this.hasMandalaCategory( frontmatter.categories ) ) {
				const categories = Array.isArray( frontmatter.categories )
					? frontmatter.categories
					: frontmatter.categories
						? [ frontmatter.categories ]
						: [];
				categories.push( '[[mandala]]' );
				frontmatter.categories = categories;
			}
		} );

		await this.renameMandalaFileToTitle( file, cleanTitle );

		this.metadataCheckedPaths.add( file.path );
		new Notice( `Mandala title changed to ${ cleanTitle }.` );
		await this.refreshViews();
		return true;
	}

	async saveCenterCell( file, title, summary ) {
		const cache = this.app.metadataCache.getFileCache( file );
		const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
		const role = this.getMandalaRoleFromFrontmatter( frontmatter, file );
		if ( role === 'root' ) {
			return this.saveRootCell( file, title, summary );
		}

		const cleanTitle = String( title || '' ).trim();
		if ( ! cleanTitle ) {
			new Notice( 'タイトルを入力してください。' );
			return false;
		}

		await this.app.fileManager.processFrontMatter( file, ( currentFrontmatter ) => {
			currentFrontmatter.mandala_title = cleanTitle;
			if ( summary ) {
				currentFrontmatter.mandala_summary = summary;
			} else {
				delete currentFrontmatter.mandala_summary;
			}
			if ( ! currentFrontmatter.created ) {
				currentFrontmatter.created = this.getLocalDate();
			}
			if ( ! currentFrontmatter.mandala_color_mode ) {
				currentFrontmatter.mandala_color_mode = 'inherit';
			}
			if ( ! this.hasMandalaCategory( currentFrontmatter.categories ) ) {
				const categories = Array.isArray( currentFrontmatter.categories )
					? currentFrontmatter.categories
					: currentFrontmatter.categories
						? [ currentFrontmatter.categories ]
						: [];
				categories.push( '[[mandala]]' );
				currentFrontmatter.categories = categories;
			}
		} );
		await this.renameMandalaFileToTitle( file, cleanTitle );

		this.metadataCheckedPaths.add( file.path );
		new Notice( `Mandala title changed to ${ cleanTitle }.` );
		await this.refreshViews();
		return true;
	}

	updateViewPaths( oldPath, newPath ) {
		for ( const leaf of this.app.workspace.getLeavesOfType( VIEW_TYPE ) ) {
			const view = leaf.view;
			if ( ! view ) {
				continue;
			}
			if ( view.sourcePath === oldPath ) {
				view.sourcePath = newPath;
			}
			if ( Array.isArray( view.track ) ) {
				view.track = view.track.map(
					( path ) => path === oldPath ? newPath : path
				);
			}
		}
		this.app.workspace.requestSaveLayout();
	}

	async saveCell( sourceFile, position, noteName, title, summary, connectionType = '' ) {
		const cleanName = this.cleanLink( noteName );
		const cleanTitle = String( title || '' ).trim();
		if ( ! cleanTitle ) {
			new Notice( 'タイトルを入力してください。' );
			return false;
		}

		let linkedFile = cleanName
			? this.app.metadataCache.getFirstLinkpathDest( cleanName, sourceFile.path )
			: null;
		const requestedType = String( connectionType || '' ).trim().toLowerCase();
		let resolvedConnectionType = [ 'child', 'reference' ].includes( requestedType )
			? requestedType
			: '';
		if ( ! linkedFile ) {
			resolvedConnectionType = 'child';
			await this.ensureMandalaFolder();
			const newPath = this.getAvailableMandalaPath( null, cleanTitle );
			const body = [
				'---',
				`mandala_title: ${ JSON.stringify( cleanTitle ) }`,
				`created: ${ this.getLocalDate() }`,
				'mandala_role: child',
				`mandala_parent: ${ JSON.stringify( this.getMandalaLink( sourceFile ) ) }`,
				`mandala_summary: ${ JSON.stringify( summary || '' ) }`,
				'mandala_color_mode: inherit',
				'categories:',
				'  - "[[mandala]]"',
				'---',
				'',
			].join( '\n' );
			linkedFile = await this.app.vault.create( newPath, body );
			this.metadataCheckedPaths.add( linkedFile.path );
		} else {
			if ( ! resolvedConnectionType ) {
				const sourceCache = this.app.metadataCache.getFileCache( sourceFile );
				const sourceFrontmatter = sourceCache && sourceCache.frontmatter
					? sourceCache.frontmatter
					: {};
				resolvedConnectionType = this.getCellConnectionType(
					sourceFrontmatter,
					position,
					linkedFile
				);
			}
			await this.app.fileManager.processFrontMatter( linkedFile, ( frontmatter ) => {
				if ( resolvedConnectionType === 'child' ) {
					frontmatter.mandala_role = this.getMandalaRoleFromFrontmatter(
						frontmatter,
						linkedFile
					);
					if ( frontmatter.mandala_role === 'root' ) {
						delete frontmatter.mandala_parent;
					}
					if ( ! frontmatter.created ) {
						frontmatter.created = this.getLocalDate();
					}
					if ( ! frontmatter.mandala_color_mode ) {
						frontmatter.mandala_color_mode = 'inherit';
					}
				}
				frontmatter.mandala_title = cleanTitle;
				if ( summary ) {
					frontmatter.mandala_summary = summary;
				} else {
					delete frontmatter.mandala_summary;
				}
				if ( ! this.hasMandalaCategory( frontmatter.categories ) ) {
					const categories = Array.isArray( frontmatter.categories )
						? frontmatter.categories
						: frontmatter.categories
							? [ frontmatter.categories ]
							: [];
					categories.push( '[[mandala]]' );
					frontmatter.categories = categories;
				}
			} );
			this.metadataCheckedPaths.add( linkedFile.path );
			if ( resolvedConnectionType === 'child' ) {
				await this.renameMandalaFileToTitle( linkedFile, cleanTitle );
			}
		}

		await this.app.fileManager.processFrontMatter( sourceFile, ( frontmatter ) => {
			const property = `mandala_${ position }`;
			const typeProperty = `${ property }_type`;
			frontmatter[ property ] = this.getMandalaLink( linkedFile );
			frontmatter[ typeProperty ] = resolvedConnectionType
				|| this.getCellConnectionType( frontmatter, position, linkedFile );
		} );

		const expectedSummary = String( summary || '' );
		await this.waitForFileMetadata( linkedFile, ( frontmatter ) => (
			String( frontmatter.mandala_title || '' ).trim() === cleanTitle
			&& String( frontmatter.mandala_summary || '' ) === expectedSummary
		) );

		new Notice( `Connected to ${ cleanTitle }.` );
		await this.refreshViews();
		return true;
	}

	async refreshViews() {
		for ( const leaf of this.app.workspace.getLeavesOfType( VIEW_TYPE ) ) {
			if ( leaf.view && typeof leaf.view.render === 'function' ) {
				await leaf.view.render();
			}
		}
		for ( const leaf of this.app.workspace.getLeavesOfType( EXPLORER_VIEW_TYPE ) ) {
			if ( leaf.view && typeof leaf.view.render === 'function' ) {
				await leaf.view.render();
			}
		}
	}
};
