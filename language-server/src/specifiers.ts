
export let ASPropertySpecifiers : any = {
    "BlueprintReadWrite": "Allow the property to be read and written from blueprint nodes",
    "BlueprintReadOnly": "Allow the property to be read from blueprint but not written",
    "BlueprintHidden": "Do not make this property available to blueprint at all",
    "EditInstanceOnly": "Property can only be changed on instances in the level",
    "EditDefaultsOnly": "Property can only be changed on defaults inside blueprint classes",
    "EditAnywhere": "Property can be changed by blueprint classes and on instances in the level",
    "NotEditable": "Property cannot be edited from unreal anywhere",
    "NotVisible": "Property cannot be changed or seen in the details panel at all",
    "EditConst": "Property can be seen in the details panel but not edited",
    "VisibleAnywhere": "Property can be seen both on blueprint classes and instances in the level, but not changed",
    "VisibleInstanceOnly": "Property can only be seen on instances in the level, but not changed",
    "VisibleDefaultsOnly": "Property can only be seen on defaults inside blueprint classes, but not changed",
    "AdvancedDisplay": "Property can only be edited after expanding to advanced view",
    "Transient": "Property is never saved into the on-disk asset",
    "Config": "Property can be saved and loaded from config ini files",
    "Interp": "Property can be modified by sequence tracks",
    "NoClear": "Property is not allowed to be changed to nullptr",
    "Category": "Category to list this under in the editor",
    "Keywords": "Keywords this can be found by in the editor",
    "ToolTip": "Tooltip to show in the editor",
    "DisplayName": "Name to use to display in the editor",
    "EditInline": "Edit the values of this object inline in its container",
    "ExposeOnSpawn": "Property should be available to be changed when spawning this object from blueprint",
    "EditFixedSize": "Use on TArray propertie, the size of the array cannot be changed from the editor",
    "BlueprintProtected": "Treat this property as protected in blueprint, disallowing it from being edited by non-child blueprints",
    "DefaultComponent": "Component will be created as a default component on the actor",
    "OverrideComponent": "Specify a component in the praent class to override the class type of",
    "RootComponent": "Use on DefaultComponents, specify that this component should be the root component of the actor",
    "ShowOnActor": "Use on DefaultComponents, properties from the component will appear in the actor's details panel",
    "Attach": "Use on DefaultComponents, specify a different component to attach this to in the scene hierarchy",
    "AttachSocket": "Use on DefaultComponents with an Attach, specify a socket to attach to on this component's attach parent",
    "Meta": "Specify arbitrary meta tags",
    "Instanced": "The object in this property is a new instance for each containing instance",
    "BlueprintSetter": "Specify a function to call instead when writing this property from blueprint",
    "BlueprintGetter": "Specify a function to call instead when reading this property from blueprint",
    "BindWidget": "Automatically bind this property to the widget with the same name within child UMG blueprints",
    "SaveGame": "Property should be serialized for save games",
};

export let ASClassSpecifiers : any = {
    "NotPlaceable": "Class cannot be placed in the level or on an actor by the editor",
    "NotBlueprintable": "Blueprints cannot be choose this as a parent class",
    "Blueprintable": "Blueprints can be created with this as a parent class",
    "Abstract": "Cannot be instantiated on its own, must have a child class to spawn",
    "Config": "Allow properties in this class to be saved and loaded to the specified ini",
    "Deprecated": "This class is deprecated and should not be used",
    "HideCategories": "Properties in these categories are not editable on this class",
    "DefaultConfig": "Config properties on this class should be saved to default configs, not user configs",
    "ComponentWrapperClass": "Actor is a lightweight wrapper around a single component",
    "ClassGroup": "List this class under the specified group in the editor",
    "DefaultToInstanced": "Indicates that references to this class default to instanced",
    "EditInlineNew": "Class can be constructed from editinline New button",
    "Meta": "Specify arbitrary meta tags",
};

export let ASStructSpecifiers : any = {
    "Meta": "Specify arbitrary meta tags",
};

export let ASFunctionSpecifiers : any = {
    "BlueprintCallable": "Function can be called from blueprint",
    "NotBlueprintCallable": "Function is not available in blueprint at all",
    "BlueprintPure": "Function is a pure node in blueprint without an exec pin",
    "BlueprintEvent": "Function can be overridden by child blueprint classes",
    "NetFunction": "Function is a NetFunction",
    "CrumbFunction": "Function is a CrumbFunction",
    "DevFunction": "Function is a DevFunction",
    "Unreliable": "Network function is sent as unreliable",
    "BlueprintOverride": "Override a BlueprintEvent in a parent script or C++ class",
    "CallInEditor": "Create a button in the details panel to call this function in the editor",
    "Category": "Category to list this under in the editor",
    "Keywords": "Keywords this can be found by in the editor",
    "ToolTip": "Tooltip to show in the editor",
    "DisplayName": "Name to use to display the function in the editor",
    "BlueprintProtected": "Treat this function as protected in blueprint, disallowing it from being called by non-child blueprints",
    "Meta": "Specify arbitrary meta tags",
};